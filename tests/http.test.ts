import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createHttpApp, listenHost, type McpRequestHandler } from '../src/mcp/http.js';
import { getApiKey, getHost, getWorkspaceId } from '../src/utils/auth.js';

// The credential boundary of the HTTP transport, tested through a real express
// server. The MCP handler is a stub that reports the credentials in scope, so a
// refused request is proved never to reach it.

let server: Server;
let base: string;
let seen: Array<{ token: string; host: string; workspace: string }> = [];

before(async () => {
    process.env.HULY_HOST = 'https://env.example.com';
    process.env.HULY_WORKSPACE_ID = 'env-workspace';
    process.env.HULY_API_KEY = 'env-token';
    delete process.env.HULY_MCP_AUTH_TOKEN;
    delete process.env.HULY_REQUIRE_CALLER_TOKEN;
    process.env.HULY_MCP_ALLOWED_HOSTS = 'https://caller.example, https://other.example/';

    const app = createHttpApp(async (req, res) => {
        if (req.body?.fail) throw new Error('ECONNREFUSED 10.0.0.7:4000 at /srv/huly/secret-path');
        const delay = Number(req.body?.delay ?? 0);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const scope = { token: getApiKey(), host: getHost(), workspace: getWorkspaceId() };
        seen.push(scope);
        res.json(scope);
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); });

beforeEach(() => { seen = []; });

function post(headers: Record<string, string>, body: object = {}) {
    return fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

for (const [name, headers] of [
    ['a caller host', { 'x-huly-url': 'https://attacker.example' }],
    ['a caller workspace', { 'x-huly-workspace': 'other-ws' }],
    ['both', { 'x-huly-url': 'https://attacker.example', 'x-huly-workspace': 'other-ws' }],
    ['mixed-case header names', { 'X-Huly-Url': 'https://attacker.example' }],
    ['an empty caller token', { 'x-huly-url': 'https://attacker.example', 'x-huly-token': '' }],
] as const) {
    test(`${name} without a caller token is refused with 400 before the handler`, async () => {
        const res = await post(headers);
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /requires? x-huly-token/);
        assert.deepEqual(seen, [], 'the MCP handler must not run');
    });
}

test('no x-huly-* headers keep the environment credentials', async () => {
    const res = await post({});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { token: 'env-token', host: 'https://env.example.com', workspace: 'env-workspace' });
});

test('an allowed caller host with a caller token and workspace uses only the caller credentials', async () => {
    const res = await post({ 'x-huly-url': 'https://caller.example', 'x-huly-token': 'caller-token', 'x-huly-workspace': 'caller-ws' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { token: 'caller-token', host: 'https://caller.example', workspace: 'caller-ws' });
});

// The server's HULY_WORKSPACE_ID is configuration, not something to hand to any
// host a caller names: with x-huly-url and no x-huly-workspace it would be sent
// to that host as part of the workspace login.
test('a caller host without a caller workspace is refused, so the server workspace never leaves', async () => {
    const res = await post({ 'x-huly-url': 'https://caller.example', 'x-huly-token': 'caller-token' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /x-huly-url requires x-huly-workspace/);
    assert.deepEqual(seen, [], 'the MCP handler must not run');
});

test('the server host named explicitly may still use the server workspace', async () => {
    const res = await post({ 'x-huly-url': 'https://env.example.com/', 'x-huly-token': 'caller-token' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).workspace, 'env-workspace');
});

// x-huly-url makes the server fetch <url>/config.json and follow the endpoints it
// lists, so an arbitrary value is a server-side request forgery primitive.
for (const [name, url] of [
    ['a host outside the allowlist', 'https://attacker.example'],
    ['cloud metadata', 'http://169.254.169.254/latest'],
    ['an allowed host as userinfo of another', 'https://caller.example@attacker.example'],
    ['a non-HTTP scheme', 'file:///etc/passwd'],
    ['a value that is not a URL', 'caller.example'],
] as const) {
    test(`${name} as x-huly-url is refused with 400 before the handler`, async () => {
        const res = await post({ 'x-huly-url': url, 'x-huly-token': 'caller-token', 'x-huly-workspace': 'caller-ws' });
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /x-huly-url/);
        assert.deepEqual(seen, [], 'the MCP handler must not run');
    });
}

test('an error inside the handler is answered 500 without its message', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    try {
        const res = await post({}, { fail: true });
        assert.equal(res.status, 500);
        const text = await res.text();
        assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.7|secret-path/);
        assert.deepEqual(JSON.parse(text), { error: 'Internal error' });
    } finally {
        stderr.mock.restore();
    }
});

test('concurrent callers each keep their own token across an await', async () => {
    const [slow, fast] = await Promise.all([
        post({ 'x-huly-token': 'caller-a' }, { delay: 30 }),
        post({ 'x-huly-token': 'caller-b' }, { delay: 1 }),
    ]);
    assert.equal((await slow.json()).token, 'caller-a');
    assert.equal((await fast.json()).token, 'caller-b');
});

// --- Bearer guard -----------------------------------------------------------

async function withGuardedApp(fn: (url: string) => Promise<void>): Promise<void> {
    process.env.HULY_MCP_AUTH_TOKEN = 'the-shared-secret';
    const handler: McpRequestHandler = async (_req, res) => { res.json({ ok: true }); };
    const app = createHttpApp(handler);
    delete process.env.HULY_MCP_AUTH_TOKEN;
    const guarded = app.listen(0);
    await new Promise((resolve) => guarded.once('listening', resolve));
    try {
        await fn(`http://127.0.0.1:${(guarded.address() as AddressInfo).port}/mcp`);
    } finally {
        guarded.close();
    }
}

function postWith(url: string, authorization?: string) {
    return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorization !== undefined ? { authorization } : {}) },
        body: '{}',
    });
}

test('the Bearer guard admits only the exact shared secret', async () => {
    await withGuardedApp(async (url) => {
        assert.equal((await postWith(url, 'Bearer the-shared-secret')).status, 200);
        for (const wrong of [undefined, '', 'Bearer ', 'Bearer the-shared-secreT', 'Bearer the-shared-secret-and-more', 'Bearer x', 'the-shared-secret']) {
            assert.equal((await postWith(url, wrong)).status, 401, `authorization ${JSON.stringify(wrong)}`);
        }
    });
});

// A `!==` on the raw strings returns as soon as a byte differs, so the response
// time leaks how much of a guess was right. The guard hashes both sides to one
// length and compares them in constant time instead.
test('the Bearer guard compares in constant time over equal-length digests', async () => {
    const compare = mock.method(crypto, 'timingSafeEqual');
    try {
        await withGuardedApp(async (url) => {
            assert.equal((await postWith(url, 'Bearer short')).status, 401);
        });
        assert.equal(compare.mock.callCount(), 1);
        const [a, b] = compare.mock.calls[0].arguments as [Buffer, Buffer];
        assert.equal(a.length, b.length);
        assert.equal(a.length, 32);
    } finally {
        compare.mock.restore();
    }
});

// --- Bind address -------------------------------------------------------------

test('without an auth token the server listens on loopback only', () => {
    assert.equal(listenHost({}), '127.0.0.1');
    assert.equal(listenHost({ HULY_MCP_AUTH_TOKEN: '' }), '127.0.0.1');
});

test('with an auth token the server keeps listening on every interface', () => {
    assert.equal(listenHost({ HULY_MCP_AUTH_TOKEN: 'secret' }), undefined);
});

test('HULY_MCP_HOST chooses the bind address explicitly either way', () => {
    assert.equal(listenHost({ HULY_MCP_HOST: '0.0.0.0' }), '0.0.0.0');
    assert.equal(listenHost({ HULY_MCP_HOST: '::1', HULY_MCP_AUTH_TOKEN: 'secret' }), '::1');
});
