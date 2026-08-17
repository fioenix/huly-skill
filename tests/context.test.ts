import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { decodeTokenClaims, describeContext } from '../src/utils/context.js';
import { runWithCredentials } from '../src/utils/auth.js';

function makeToken(payload: Record<string, unknown>): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ typ: 'JWT', alg: 'HS256' })}.${part(payload)}.signature-not-verified`;
}

const WORKSPACE = '098f54fd-611a-41f7-b817-b69282fe8d91';

beforeEach(() => {
    process.env.HULY_HOST = 'https://huly.example.com';
    process.env.HULY_WORKSPACE_ID = WORKSPACE;
    process.env.HULY_API_KEY = makeToken({ account: 'account-uuid', workspace: WORKSPACE, extra: {} });
    delete process.env.HULY_ACTOR;
    delete process.env.HULY_DEFAULT_ASSIGNEE;
});

test('reads account and workspace out of the token payload', () => {
    const claims = decodeTokenClaims(makeToken({ account: 'a', workspace: 'w' }));
    assert.equal(claims?.account, 'a');
    assert.equal(claims?.workspace, 'w');
});

test('reports extra as key names only — values carry admin flags', () => {
    const claims = decodeTokenClaims(makeToken({ account: 'a', extra: { admin: 'true' } }));
    assert.deepEqual(claims?.extraKeys, ['admin']);
});

test('a token that is not a JWT decodes to null rather than throwing', () => {
    assert.equal(decodeTokenClaims('not-a-token'), null);
    assert.equal(decodeTokenClaims('a.b.c'), null);
    assert.equal(decodeTokenClaims(undefined), null);
});

test('a healthy configuration produces no warnings', () => {
    assert.deepEqual(describeContext().warnings, []);
});

test('never returns the token itself', () => {
    const token = process.env.HULY_API_KEY as string;
    const serialized = JSON.stringify(describeContext());
    assert.equal(serialized.includes(token), false);
    assert.match(describeContext().apiKey.masked, /^.{4}\.\.\..{4}$/);
});

test('trims the host to its origin — a Huly URL can carry a token in its path', () => {
    process.env.HULY_HOST = 'https://huly.example.com/login/auth?token=secret';
    assert.equal(describeContext().host, 'https://huly.example.com');
});

test('warns when the token is bound to a different workspace', () => {
    process.env.HULY_WORKSPACE_ID = 'some-other-workspace';
    assert.match(describeContext().warnings.join(' '), /bound to workspace/);
});

test('warns that an unbound token needs a slug rather than a UUID', () => {
    process.env.HULY_API_KEY = makeToken({ account: 'account-uuid' });
    assert.match(describeContext().warnings.join(' '), /URL slug, not a UUID/);
});

test('accepts an unbound token when the workspace is a slug', () => {
    process.env.HULY_API_KEY = makeToken({ account: 'account-uuid' });
    process.env.HULY_WORKSPACE_ID = 'yody';
    assert.deepEqual(describeContext().warnings, []);
});

test('warns on an expired token', () => {
    process.env.HULY_API_KEY = makeToken({
        account: 'a', workspace: WORKSPACE, exp: Math.floor(Date.now() / 1000) - 60,
    });
    assert.match(describeContext().warnings.join(' '), /expired/);
});

test('names every missing variable', () => {
    delete process.env.HULY_HOST;
    delete process.env.HULY_WORKSPACE_ID;
    delete process.env.HULY_API_KEY;
    const warnings = describeContext().warnings.join(' ');
    for (const name of ['HULY_HOST', 'HULY_WORKSPACE_ID', 'HULY_API_KEY']) {
        assert.match(warnings, new RegExp(`${name} is not set`));
    }
});

test('describes the caller credentials in scope, not the environment', () => {
    const callerToken = makeToken({ account: 'caller-account', workspace: 'caller-ws' });
    const context = runWithCredentials({ token: callerToken, workspace: 'caller-ws' }, describeContext);
    assert.equal(context.credentialSource, 'request');
    assert.equal(context.apiKey.claims?.account, 'caller-account');
    assert.equal(context.warnings.length, 0);
});
