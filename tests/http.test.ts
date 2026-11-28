import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createHttpApp } from '../src/mcp/http.js';
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

    const app = createHttpApp(async (req, res) => {
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

test('a caller host with a caller token uses only the caller credentials', async () => {
    const res = await post({ 'x-huly-url': 'https://caller.example', 'x-huly-token': 'caller-token' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { token: 'caller-token', host: 'https://caller.example', workspace: 'env-workspace' });
});

test('concurrent callers each keep their own token across an await', async () => {
    const [slow, fast] = await Promise.all([
        post({ 'x-huly-token': 'caller-a' }, { delay: 30 }),
        post({ 'x-huly-token': 'caller-b' }, { delay: 1 }),
    ]);
    assert.equal((await slow.json()).token, 'caller-a');
    assert.equal((await fast.json()).token, 'caller-b');
});
