import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { createProxySocketFactory, fetchProxyOptions, proxyAgent, redactUrl, wsOptions } from '../src/utils/proxy.js';

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

test('the fetch proxy options leave certificate verification to Node', () => {
    const options: any = fetchProxyOptions('http://127.0.0.1:3128');
    assert.equal(options.uri, 'http://127.0.0.1:3128');
    assert.notEqual(options.requestTls?.rejectUnauthorized, false);
    assert.notEqual(options.proxyTls?.rejectUnauthorized, false);
});

test('the proxy socket keeps the WebSocket contract the Huly client relies on', async () => {
    const created: any[] = [];
    class RecordingWebSocket {
        readyState = 1;
        handlers: Record<string, (...args: any[]) => void> = {};
        sent: any[] = [];
        closed: any[] = [];
        constructor(public url: string, public options: any) { created.push(this); }
        on(event: string, handler: (...args: any[]) => void) { this.handlers[event] = handler; return this; }
        send(data: any) { this.sent.push(data); }
        close(code?: number) { this.closed.push(code); }
    }
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = () => true;
    try {
        const client = createProxySocketFactory('http://127.0.0.1:3128', RecordingWebSocket)!('wss://huly.example/t');
        const ws = created[0];
        assert.equal(ws.url, 'wss://huly.example/t');
        assert.ok(ws.options.agent, 'connects through the proxy agent');
        assert.notEqual(ws.options.rejectUnauthorized, false);
        assert.deepEqual(Object.keys(ws.handlers).sort(), ['close', 'error', 'message', 'open', 'unexpected-response']);
        assert.equal(client.readyState, 1);

        const events: any[] = [];
        client.onopen = (e: any) => events.push(['open', e.type]);
        client.onmessage = (e: any) => events.push(['message', e.data]);
        client.onclose = (e: any) => events.push(['close', e.code, e.wasClean]);
        client.onerror = (e: any) => events.push(['error', e.error.message]);
        ws.handlers.open();
        ws.handlers.message('payload');
        ws.handlers.error(new Error('boom'));
        ws.handlers.close(1000, Buffer.from(''));
        ws.handlers.close(1006, Buffer.from('gone'));
        assert.deepEqual(events, [
            ['open', 'open'], ['message', 'payload'], ['error', 'boom'],
            ['close', 1000, true], ['close', 1006, false],
        ]);

        client.send('text');
        client.send(new Blob([new Uint8Array([1, 2, 3])]));
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(ws.sent[0], 'text');
        assert.deepEqual([...new Uint8Array(ws.sent[1])], [1, 2, 3], 'a Blob is sent as its bytes');

        client.close(4000);
        assert.deepEqual(ws.closed, [4000]);
    } finally {
        (process.stderr as any).write = original;
    }
});

test('a Buffer message reaches the Huly client as an ArrayBuffer, as the upstream factory delivers it', () => {
    let handler: ((data: any) => void) | undefined;
    class BufferWebSocket { readyState = 1; on(e: string, h: any) { if (e === 'message') handler = h; return this; } send() {} close() {} }
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = () => true;
    try {
        const client = createProxySocketFactory('http://127.0.0.1:3128', BufferWebSocket)!('wss://huly.example/t');
        const received: any[] = [];
        client.onmessage = (e: any) => received.push(e.data);
        handler!(Buffer.from('pong!'));
        handler!('ping');
        assert.ok(received[0] instanceof ArrayBuffer, 'Huly matches heartbeats only on strings and ArrayBuffers');
        assert.equal(new TextDecoder().decode(received[0]), 'pong!');
        assert.equal(received[1], 'ping');
    } finally {
        (process.stderr as any).write = original;
    }
});
