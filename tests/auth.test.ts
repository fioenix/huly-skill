import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    credentialSource,
    credentialsError,
    getApiKey,
    getHost,
    getWorkspaceId,
    maskToken,
    peekCredentials,
    runWithCredentials,
} from '../src/utils/auth.js';

beforeEach(() => {
    process.env.HULY_HOST = 'https://env.example.com';
    process.env.HULY_WORKSPACE_ID = 'env-workspace';
    process.env.HULY_API_KEY = 'env-token';
    process.env.HULY_MCP_ALLOWED_HOSTS = 'https://caller.example.com';
});

test('falls back to the environment — a shared token keeps working', () => {
    assert.equal(getHost(), 'https://env.example.com');
    assert.equal(getWorkspaceId(), 'env-workspace');
    assert.equal(getApiKey(), 'env-token');
    assert.equal(credentialSource(), 'environment');
});

test('caller credentials win inside their scope', () => {
    runWithCredentials({ token: 'caller-token', host: 'https://caller.example.com', workspace: 'caller-ws' }, () => {
        assert.equal(getApiKey(), 'caller-token');
        assert.equal(getHost(), 'https://caller.example.com');
        assert.equal(getWorkspaceId(), 'caller-ws');
        assert.equal(credentialSource(), 'request');
    });
});

test('a caller may override only the token', () => {
    runWithCredentials({ token: 'caller-token' }, () => {
        assert.equal(getApiKey(), 'caller-token');
        assert.equal(getHost(), 'https://env.example.com', 'host still comes from the environment');
        assert.equal(getWorkspaceId(), 'env-workspace');
    });
});

test('the scope does not leak past the call', () => {
    runWithCredentials({ token: 'caller-token' }, () => getApiKey());
    assert.equal(getApiKey(), 'env-token');
    assert.equal(credentialSource(), 'environment');
});

test('the scope survives an await boundary', async () => {
    await runWithCredentials({ token: 'caller-token' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        assert.equal(getApiKey(), 'caller-token');
    });
});

test('missing credentials throw a message naming the variable', () => {
    delete process.env.HULY_API_KEY;
    assert.throws(getApiKey, /HULY_API_KEY/);
    delete process.env.HULY_HOST;
    assert.throws(getHost, /HULY_HOST/);
    delete process.env.HULY_WORKSPACE_ID;
    assert.throws(getWorkspaceId, /HULY_WORKSPACE_ID/);
});

test('peekCredentials reports a broken configuration instead of throwing', () => {
    delete process.env.HULY_API_KEY;
    assert.equal(peekCredentials().token, undefined);
});

test('maskToken keeps only the ends, and hides short secrets entirely', () => {
    assert.equal(maskToken('abcdefghijklmnop'), 'abcd...mnop');
    assert.equal(maskToken('short'), '****');
    assert.equal(maskToken(''), '');
});

// A caller that redirects the host or workspace must bring its own token: the
// server's token sent to a caller-chosen host is a leaked token.
test('a caller host without a caller token never reaches the server token', () => {
    assert.throws(
        () => runWithCredentials({ host: 'https://attacker.example' }, () => getApiKey()),
        /x-huly-token/,
    );
});

test('a caller workspace without a caller token is refused too', () => {
    assert.throws(
        () => runWithCredentials({ workspace: 'other-ws' }, () => getApiKey()),
        /x-huly-token/,
    );
});

test('credentialsError names the problem only for a target without a token', () => {
    assert.match(credentialsError({ host: 'https://attacker.example' }) ?? '', /x-huly-url/);
    assert.match(credentialsError({ workspace: 'other-ws' }) ?? '', /x-huly-workspace/);
    assert.equal(credentialsError({}), null);
    assert.equal(credentialsError({ token: 'caller-token' }), null);
    assert.equal(credentialsError({ token: 'caller-token', host: 'https://caller.example.com', workspace: 'ws' }), null);
});

// runWithCredentials is the boundary every entry point goes through, so the host
// rules hold there too and not only in the HTTP transport.
test('a caller host must be allowed and bring its own workspace', () => {
    assert.throws(
        () => runWithCredentials({ token: 'caller-token', host: 'http://169.254.169.254', workspace: 'ws' }, () => getApiKey()),
        /not an allowed host/,
    );
    assert.throws(
        () => runWithCredentials({ token: 'caller-token', host: 'https://caller.example.com' }, () => getWorkspaceId()),
        /x-huly-url requires x-huly-workspace/,
    );
    assert.equal(credentialsError({ token: 'caller-token', host: 'https://env.example.com' }), null);
    assert.match(credentialsError({ token: 'caller-token', host: 'javascript:alert(1)', workspace: 'ws' }) ?? '', /http\(s\) origin/);
});

test('the host in scope is the checked origin, not the string passed in', () => {
    const host = runWithCredentials({ token: 'caller-token', host: '  https://env.example.com  ' }, () => getHost());
    assert.equal(host, 'https://env.example.com');
});

test('a host with a path, query, fragment or userinfo is refused', () => {
    for (const host of ['https://env.example.com/sub', 'https://env.example.com?x=1', 'https://env.example.com/#f', 'https://a:b@caller.example.com']) {
        assert.match(credentialsError({ token: 'caller-token', host, workspace: 'ws' }) ?? '', /x-huly-url/, host);
    }
});

// The HTTP transport turns an empty header into "absent"; a direct caller of
// runWithCredentials gets the same reading rather than a looser one.
test('an empty or blank token or workspace counts as absent', () => {
    assert.throws(
        () => runWithCredentials({ token: '', host: 'https://caller.example.com', workspace: '' }, () => getApiKey()),
        /requires x-huly-token/,
    );
    assert.throws(
        () => runWithCredentials({ token: 'caller-token', host: 'https://caller.example.com', workspace: '  ' }, () => getWorkspaceId()),
        /requires x-huly-workspace/,
    );
    assert.equal(runWithCredentials({ token: '  ' }, () => getApiKey()), 'env-token');
});
