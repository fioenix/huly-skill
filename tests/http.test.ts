import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createHttpApp, listenAddress, listenHost, type McpRequestHandler } from '../src/mcp/http.js';
import { allowedHostsWarning, getApiKey, getHost, getWorkspaceId } from '../src/utils/auth.js';

// The credential boundary of the HTTP transport, tested through a real express
// server. The MCP handler is a stub that reports the credentials in scope, so a
// refused request is proved never to reach it.

// NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR and the C1 CSI introducer.
const [NEL, LS, PS, CSI] = [0x85, 0x2028, 0x2029, 0x9b].map((code) => String.fromCharCode(code));

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
        if (req.body?.failWithSecrets) {
            throw new Error(
                'socket failed wss://transactor.example/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlX3Rlc3Q at https://u:p@host.example/x?token=abc\n[huly-mcp] forged line',
                { cause: new Error('ECONNRESET https://cause.example/path?token=zzz') },
            );
        }
        if (req.body?.failWithUnicodeBreaks) {
            throw new Error(['a', NEL, '[huly-mcp] forged NEL', LS, '[huly-mcp] forged LS', PS, 'b', CSI, '31m csi'].join(''));
        }
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
    // The origin matches, but whatever follows it would reach the connection:
    // a path or query re-targets `<host>/config.json`, userinfo reaches fetch.
    ['a path on the server host', 'https://env.example.com/evil'],
    ['a query that swallows /config.json', 'https://env.example.com/?x='],
    ['a fragment that swallows /config.json', 'https://env.example.com/#x'],
    ['userinfo on an allowed host', 'https://user:secret@caller.example'],
    ['a backslash path on the server host', 'https://env.example.com\\evil'],
] as const) {
    test(`${name} as x-huly-url is refused with 400 before the handler`, async () => {
        const res = await post({ 'x-huly-url': url, 'x-huly-token': 'caller-token', 'x-huly-workspace': 'caller-ws' });
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /x-huly-url/);
        assert.deepEqual(seen, [], 'the MCP handler must not run');
    });
}

// What reaches getHost() — and the connection — is the origin that was checked,
// never the raw header.
test('an accepted x-huly-url is reduced to its origin before it is used', async () => {
    const res = await post({ 'x-huly-url': ' HTTPS://Caller.Example:443/ ', 'x-huly-token': 'caller-token', 'x-huly-workspace': 'caller-ws' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).host, 'https://caller.example');
});

test('every origin in HULY_MCP_ALLOWED_HOSTS is accepted, trailing slash or not', async () => {
    const res = await post({ 'x-huly-url': 'https://other.example', 'x-huly-token': 'caller-token', 'x-huly-workspace': 'caller-ws' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).host, 'https://other.example');
});

function postRaw(url: string, body: string, headers: Record<string, string> = {}) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}

// Express's default error page is HTML with a stack trace outside production.
test('a malformed JSON body is answered with a JSON 400 and no stack trace', async () => {
    const res = await postRaw(`${base}/mcp`, '{');
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'Invalid JSON' });
    assert.doesNotMatch(text, /node_modules|at .*\(/);
    assert.equal(res.headers.get('x-powered-by'), null);
});

test('an error inside the handler is answered 500 without its message', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    try {
        const res = await post({}, { fail: true });
        assert.equal(res.status, 500);
        const text = await res.text();
        assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.7|secret-path/);
        assert.deepEqual(JSON.parse(text), { error: 'Internal error' });
        assert.equal(stderr.mock.callCount(), 1, 'the detail goes to the operator log once');
        assert.match(String(stderr.mock.calls[0].arguments[0]), /request failed .*ECONNREFUSED/);
    } finally {
        stderr.mock.restore();
    }
});

// SECURITY.md puts a token reaching stderr in scope: a Huly WebSocket URL carries
// the JWT in its path, and a host may carry user:pass@ or ?token=.
test('the logged error keeps only URL origins, masks JWTs and stays on one line', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    try {
        const res = await post({}, { failWithSecrets: true });
        assert.equal(res.status, 500);
        const line = String(stderr.mock.calls[0].arguments[0]);
        assert.doesNotMatch(line, /eyJ|token=|u:p@|\/x\?|zzz|\/path/);
        assert.match(line, /wss:\/\/transactor\.example/);
        assert.match(line, /https:\/\/host\.example/);
        assert.match(line, /ECONNRESET https:\/\/cause\.example/, 'the cause is logged too');
        assert.equal(line.indexOf('\n'), line.length - 1, 'one line, ended by its own newline');
    } finally {
        stderr.mock.restore();
    }
});

// Unicode line breaks and C1 controls break lines or drive terminals just as \n
// and ESC do, so they must not reach the log either.
test('the logged error drops Unicode line breaks and C1 controls too', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    try {
        const res = await post({}, { failWithUnicodeBreaks: true });
        assert.equal(res.status, 500);
        const line = String(stderr.mock.calls[0].arguments[0]);
        for (const char of [NEL, LS, PS, CSI]) {
            assert.equal(line.includes(char), false, `U+${char.charCodeAt(0).toString(16).padStart(4, '0')} reached the log`);
        }
        assert.match(line, /a \[huly-mcp\] forged NEL \[huly-mcp\] forged LS b 31m csi\n$/);
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

// The guard must read x-huly-token as the credential scope does: a value that
// trims to nothing would otherwise pass it and then fall back to HULY_API_KEY.
// U+00A0 survives the HTTP parser (which trims only SP and HTAB) but not .trim().
for (const [name, headers] of [
    ['a missing caller token', {}],
    ['an empty caller token', { 'x-huly-token': '' }],
    ['a caller token of spaces', { 'x-huly-token': '   ' }],
    ['a caller token of NO-BREAK SPACE', { 'x-huly-token': ' ' }],
    ['a caller token of NO-BREAK SPACE and spaces', { 'x-huly-token': '    ' }],
] as const) {
    test(`${name} is refused 401 under HULY_REQUIRE_CALLER_TOKEN=true, without the server token`, async () => {
        process.env.HULY_REQUIRE_CALLER_TOKEN = 'true';
        try {
            const res = await post(headers);
            assert.equal(res.status, 401);
            assert.match((await res.json()).error, /x-huly-token header required/);
            assert.deepEqual(seen, [], 'the MCP handler must not run');
        } finally {
            delete process.env.HULY_REQUIRE_CALLER_TOKEN;
        }
    });
}

test('a real caller token passes HULY_REQUIRE_CALLER_TOKEN=true', async () => {
    process.env.HULY_REQUIRE_CALLER_TOKEN = 'true';
    try {
        const res = await post({ 'x-huly-token': 'caller-token' });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).token, 'caller-token');
    } finally {
        delete process.env.HULY_REQUIRE_CALLER_TOKEN;
    }
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

test('HULY_MCP_HOST is trimmed, and a blank one counts as unset', () => {
    assert.equal(listenHost({ HULY_MCP_HOST: ' 0.0.0.0 ' }), '0.0.0.0');
    assert.equal(listenHost({ HULY_MCP_HOST: '   ' }), '127.0.0.1');
});

test('a blank auth token does not open every interface', () => {
    assert.equal(listenHost({ HULY_MCP_AUTH_TOKEN: '   ' }), '127.0.0.1');
});

test('the listening line brackets an IPv6 address', () => {
    assert.equal(listenAddress('::1', 3000), '[::1]:3000');
    assert.equal(listenAddress('127.0.0.1', 3000), '127.0.0.1:3000');
    assert.equal(listenAddress(undefined, 3000), ':3000');
});

// A secret store or template that leaves only whitespace, or pads the secret,
// would otherwise yield a guard nobody can pass (the HTTP parser trims the
// header) or, trimmed silently, an open endpoint. Refusing to start says so.
test('an auth token that is blank or padded with whitespace refuses to start', () => {
    for (const value of ['   ', ' secret', 'secret\n']) {
        process.env.HULY_MCP_AUTH_TOKEN = value;
        try {
            assert.throws(() => createHttpApp(async () => {}), /HULY_MCP_AUTH_TOKEN/);
        } finally {
            delete process.env.HULY_MCP_AUTH_TOKEN;
        }
    }
});

// The body is parsed only once the caller is through the Bearer guard.
test('an unauthenticated malformed body is answered 401, not parsed', async () => {
    await withGuardedApp(async (url) => {
        const res = await postRaw(url, '{');
        assert.equal(res.status, 401);
        assert.deepEqual(await res.json(), { error: 'Unauthorized' });
    });
});

test('an oversized body is answered with a JSON 413', async () => {
    const res = await postRaw(`${base}/mcp`, JSON.stringify({ pad: 'x'.repeat(200 * 1024) }));
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body too large' });
});

// --- HULY_MCP_ALLOWED_HOSTS ---------------------------------------------------

test('entries of HULY_MCP_ALLOWED_HOSTS that are not origins are named at startup', () => {
    const warning = allowedHostsWarning({ HULY_MCP_ALLOWED_HOSTS: 'huly.corp.example, https://ok.example,ftp://x.example, https://a:b@c.example' });
    assert.match(warning ?? '', /entries 1, 3, 4/);
    assert.match(warning ?? '', /http\(s\):\/\//);
    assert.doesNotMatch(warning ?? '', /huly\.corp|a:b/, 'values are not echoed');
    assert.equal(allowedHostsWarning({ HULY_MCP_ALLOWED_HOSTS: 'https://ok.example, ,https://two.example/' }), null);
    assert.equal(allowedHostsWarning({}), null);
});
