import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProxySocketFactory, redactUrl } from '../src/utils/proxy.js';

// The Huly WebSocket URL carries the account JWT in its path
// (`wss://<transactor>/<JWT>`), and a proxy URL may carry `user:pass@`.
// Diagnostics print only where a connection goes, never what authenticates it.
test('redactUrl keeps scheme and host, drops credentials, path and query', () => {
    assert.equal(redactUrl('wss://huly.example/eyJhbGciOi.payload.sig?sessionId=1'), 'wss://huly.example');
    assert.equal(redactUrl('http://user:secret@127.0.0.1:3128'), 'http://127.0.0.1:3128');
    assert.equal(redactUrl('not a url'), '<unparseable url>');
});

test('the proxy socket factory logs where it connects without the token in the URL', () => {
    class FakeWebSocket { readyState = 0; on() { return this; } send() {} close() {} }
    const factory = createProxySocketFactory('http://user:secret@127.0.0.1:3128', FakeWebSocket)!;
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: any) => { written.push(String(chunk)); return true; };
    try {
        factory('wss://huly.example/eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50IjoiYSJ9.c2lnbmF0dXJl');
    } finally {
        (process.stderr as any).write = original;
    }
    const log = written.join('');
    assert.match(log, /connecting: wss:\/\/huly\.example via proxy http:\/\/127\.0\.0\.1:3128/);
    assert.doesNotMatch(log, /eyJ|secret/);
});
