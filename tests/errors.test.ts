import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXIT_STATUS, classifyError, errorPayload, exitStatusFor, hulyError } from '../src/utils/errors.js';

test('a dropped connection is the one class worth retrying', () => {
    const payload = errorPayload(new Error('WebSocket connection closed'));
    assert.equal(payload.code, 'connection');
    assert.equal(payload.retryable, true);
});

test('a missing object is never retryable — the agent must change the id', () => {
    for (const message of ['Task not found: DELTA-1', 'Khong tim thay teamspace: X', 'Du an khong ton tai: Y']) {
        const payload = errorPayload(new Error(message));
        assert.equal(payload.code, 'not_found', message);
        assert.equal(payload.retryable, false);
    }
});

test('a credential problem outranks the connection failure it causes', () => {
    assert.equal(classifyError(new Error('HULY_API_KEY is not set; cannot open socket')), 'auth');
});

test('an auth failure points at the offline diagnostic', () => {
    assert.match(errorPayload(new Error('401 Unauthorized')).hint ?? '', /huly_context/);
});

test('reads the code out of a network error where the message says nothing', () => {
    const e = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), {}) });
    assert.equal(classifyError(e), 'connection');
});

test('an unclassified failure defaults to not retryable', () => {
    const payload = errorPayload(new Error('something went sideways'));
    assert.equal(payload.code, 'unknown');
    assert.equal(payload.retryable, false);
    assert.equal(payload.hint, undefined);
});

test('an explicit code wins over what the message looks like', () => {
    assert.equal(classifyError(hulyError('invalid_input', 'Task not found: X')), 'invalid_input');
});

test('the human message is passed through untouched', () => {
    assert.equal(errorPayload(new Error('Khong tim thay task: DELTA-9')).error, 'Khong tim thay task: DELTA-9');
});

test('a non-Error rejection still produces an envelope', () => {
    assert.equal(errorPayload('boom').error, 'boom');
    assert.equal(errorPayload(undefined).status, 'error');
});

test('exit status is distinct per class, so a shell can branch on $?', () => {
    const statuses = Object.values(EXIT_STATUS);
    assert.equal(new Set(statuses).size, statuses.length);
    assert.equal(statuses.includes(0), false, 'no failure may exit 0');
});

test('an unclassified failure keeps exit 1 — scripts that only test nonzero still work', () => {
    assert.equal(exitStatusFor(new Error('something went sideways')), 1);
});

test('exit status follows the classification', () => {
    assert.equal(exitStatusFor(new Error('Khong tim thay task: X')), EXIT_STATUS.not_found);
    assert.equal(exitStatusFor(new Error('401 Unauthorized')), EXIT_STATUS.auth);
    assert.equal(exitStatusFor(hulyError('invalid_input', 'nope')), EXIT_STATUS.invalid_input);
    assert.equal(exitStatusFor(new Error('ECONNREFUSED')), EXIT_STATUS.connection);
});
