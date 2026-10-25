import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { bundleSource } from './helpers/bundle.js';

const { createHulyHttpApp } = bundleSource('src/mcp/http.ts');
// Test-file processes are isolated; never consult real Huly configuration.
process.env.HULY_MCP_AUTH_TOKEN = 'synthetic-guard';
process.env.HULY_REQUIRE_CALLER_TOKEN = 'true';

async function request(body: Buffer, options: { encoding?: string; chunked?: boolean; auth?: boolean } = {}) {
    const app = createHulyHttpApp();
    const written: Buffer[] = [];
    const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { written.push(Buffer.from(chunk)); done(); } });
    const req = new IncomingMessage(socket as any);
    req.method = 'POST'; req.url = '/mcp'; req.httpVersion = '1.1';
    req.headers = { host: 'synthetic.invalid', 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (!options.chunked) req.headers['content-length'] = String(body.length);
    else req.headers['transfer-encoding'] = 'chunked';
    if (options.encoding) req.headers['content-encoding'] = options.encoding;
    if (options.auth) {
        req.headers.authorization = 'Bearer synthetic-guard';
        req.headers['x-huly-token'] = 'synthetic-never-used';
    }
    req.rawHeaders = Object.entries(req.headers).flatMap(([name, value]) => [name, String(value)]);
    const res = new ServerResponse(req);
    res.assignSocket(socket as any);
    const finished = new Promise<{ status: number; wire: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`HTTP stream did not finish: ${Buffer.concat(written).toString().slice(0, 500)}`)), 3000);
        res.once('finish', () => { clearTimeout(timer); resolve({ status: res.statusCode, wire: Buffer.concat(written).toString() }); });
        res.once('error', error => { clearTimeout(timer); reject(error); });
    });
    // Keep parser failures local and deterministic instead of Express's HTML
    // debug error output; the app's real middleware and route still run.
    app.use((error: any, _req: any, response: any, _next: any) => response.status(error.status ?? 500).json({ error: error.type }));
    app.handle(req, res);
    req.push(body); req.complete = true; req.push(null);
    try { return await finished; } finally { socket.destroy(); }
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } } };
const atLimit = Buffer.from(JSON.stringify({ padding: 'x'.repeat(102386) }));

test('HTTP parser keeps the existing 100kb boundary with and without Content-Length', async () => {
    assert.equal(atLimit.length, 102400);
    for (const chunked of [false, true]) {
        // At the byte ceiling parsing succeeds, then the existing auth guard
        // refuses the request. One extra whitespace byte must fail before auth.
        assert.equal((await request(atLimit, { chunked })).status, 401);
        assert.equal((await request(Buffer.concat([atLimit, Buffer.from(' ')]), { chunked })).status, 413);
    }
});

test('HTTP initialize still works for plain and compressed JSON without any Huly connection', async () => {
    const body = Buffer.from(JSON.stringify(initialize));
    for (const encoding of [undefined, 'gzip']) {
        const response = await request(encoding ? gzipSync(body) : body, { encoding, auth: true });
        assert.equal(response.status, 200);
        assert.match(response.wire, /serverInfo/);
        assert.match(response.wire, /huly-mcp/);
    }
});

test('HTTP parser bounds expanded compressed bodies and rejects malformed or trailing JSON', async () => {
    const expanded = Buffer.concat([atLimit, Buffer.from(' ')]);
    assert.equal((await request(gzipSync(expanded), { encoding: 'gzip' })).status, 413);
    for (const text of ['{"broken":', '{} trailing']) {
        assert.equal((await request(Buffer.from(text))).status, 400);
    }
});
