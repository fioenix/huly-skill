import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    credentialSource,
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
