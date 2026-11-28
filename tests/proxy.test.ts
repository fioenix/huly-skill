import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { createProxySocketFactory, proxyAgent, redactUrl, wsOptions } from '../src/utils/proxy.js';

// The Huly WebSocket URL carries the account JWT in its path
// (`wss://<transactor>/<JWT>`), and a proxy URL may carry `user:pass@`.
// Diagnostics print only where a connection goes, never what authenticates it.
test('redactUrl keeps scheme and host, drops credentials, path and query', () => {
    assert.equal(redactUrl('wss://huly.example/eyJhbGciOi.payload.sig?sessionId=1'), 'wss://huly.example');
    assert.equal(redactUrl('http://user:secret@127.0.0.1:3128'), 'http://127.0.0.1:3128');
    assert.equal(redactUrl('not a url'), '<unparseable url>');
});

// Certificate checks stay on behind a proxy. An intercepting proxy is trusted
// by giving Node its CA (NODE_EXTRA_CA_CERTS), not by turning checks off.
test('the proxy agent does not disable certificate verification', () => {
    const agent: any = proxyAgent('http://127.0.0.1:3128');
    assert.notEqual(agent.connectOpts?.rejectUnauthorized, false);
});

test('the WebSocket options do not disable certificate verification', () => {
    const options: any = wsOptions(proxyAgent('http://127.0.0.1:3128'));
    assert.notEqual(options.rejectUnauthorized, false);
});

test('loading the bootstrap with a proxy leaves NODE_TLS_REJECT_UNAUTHORIZED alone', () => {
    const env = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9' };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    const out = execFileSync(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e',
        "await import('./src/bootstrap.ts'); process.stdout.write(process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? 'unset');",
    ], { env, encoding: 'utf8' });
    assert.equal(out, 'unset');
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
