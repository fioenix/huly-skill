import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';

// These run the committed bundles, which CI rebuilds and requires to match
// their sources; mcp/tools.ts itself only loads inside the bundle.
const BIN = resolve(import.meta.dirname, '..', 'bin');

const created: string[] = [];
const children: ChildProcess[] = [];
after(() => {
    for (const child of children) child.kill();
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-attach-bin-')));
    created.push(dir);
    return dir;
}

/** Dummy credentials that point nowhere, so nothing here can reach a real workspace. */
function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        HULY_HOST: 'http://127.0.0.1:9',
        HULY_WORKSPACE_ID: '00000000-0000-0000-0000-000000000000',
        HULY_API_KEY: 'test-token-not-real',
        HULY_MCP_AUTH_TOKEN: '',
        HULY_REQUIRE_CALLER_TOKEN: 'false',
        // Empty reads as unset, so the machine's own roots never leak in.
        HULY_UPLOAD_ROOT: '',
        HULY_DOWNLOAD_ROOT: '',
        ...extra,
    };
}

const INIT = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
};

async function stdioToolNames(): Promise<string[]> {
    const child = spawn(process.execPath, [join(BIN, 'mcp.cjs')], {
        env: isolatedEnv({ HULY_MCP_TRANSPORT: 'stdio' }),
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    const send = (msg: object) => child.stdin!.write(`${JSON.stringify(msg)}\n`);

    return await new Promise<string[]>((resolveNames, reject) => {
        const timer = setTimeout(() => reject(new Error('stdio server did not answer tools/list')), 15_000);
        let buffer = '';
        child.stdout!.on('data', (chunk) => {
            buffer += chunk.toString();
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const msg = JSON.parse(line);
                if (msg.id === 1) {
                    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
                    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
                } else if (msg.id === 2) {
                    clearTimeout(timer);
                    child.kill();
                    resolveNames(msg.result.tools.map((t: any) => t.name));
                }
            }
        });
        child.on('error', reject);
        send(INIT);
    });
}

/** A port the OS just handed out, so a busy one never makes the server exit. */
async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((done) => probe.close(() => done()));
    return port;
}

// One server for every HTTP test in this file.
let httpServer: Promise<{ post: (body: object) => Promise<string> }> | null = null;
function startHttp(): Promise<{ post: (body: object) => Promise<string> }> {
    httpServer ??= launchHttp();
    return httpServer;
}

async function launchHttp(): Promise<{ post: (body: object) => Promise<string> }> {
    const port = await freePort();
    const child = spawn(process.execPath, [join(BIN, 'mcp.cjs')], {
        env: isolatedEnv({ HULY_MCP_TRANSPORT: 'http', PORT: String(port) }),
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    children.push(child);
    await new Promise<void>((ready, reject) => {
        const timer = setTimeout(() => reject(new Error('http server did not start')), 15_000);
        child.stderr!.on('data', (chunk) => {
            if (chunk.toString().includes('listening')) {
                clearTimeout(timer);
                ready();
            }
        });
        child.on('error', reject);
    });
    return {
        post: async (body) => {
            const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
                body: JSON.stringify(body),
            });
            return await res.text();
        },
    };
}

test('TC-5.2 over stdio the server offers huly_add_attachment', async () => {
    const names = await stdioToolNames();
    assert.ok(names.includes('huly_get_task'), names.join(','));
    assert.ok(names.includes('huly_add_attachment'), names.join(','));
});

test('TC-5.3 over HTTP the server does not offer huly_add_attachment', async () => {
    const server = await startHttp();
    const text = await server.post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok(text.includes('huly_get_task'), text.slice(0, 300));
    assert.ok(!text.includes('huly_add_attachment'), 'huly_add_attachment is listed over HTTP');
});

test('TC-5.5 over HTTP calling huly_add_attachment fails without reading any file', async () => {
    const dir = tempDir();
    const path = join(dir, 'secret.txt');
    writeFileSync(path, 'top secret');
    const server = await startHttp();
    const text = await server.post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'huly_add_attachment', arguments: { taskId: 'DELTA-1', paths: [path] } },
    });
    assert.match(text, /not found|error/i);
    assert.ok(!text.includes('"status": "ok"'), text.slice(0, 300));
    assert.ok(!text.includes('top secret'));
});

test('TC-6.1 the CLI rejects a path outside the root as invalid_input, exit 4, without connecting', () => {
    const root = tempDir();
    const outside = join(tempDir(), 'x.txt');
    writeFileSync(outside, 'x');
    const run = spawnSync(process.execPath, [join(BIN, 'huly.cjs'), '--json', 'attach', 'DELTA-1', outside], {
        env: isolatedEnv({ HULY_UPLOAD_ROOT: root }),
        encoding: 'utf8',
        timeout: 15_000,
    });
    assert.equal(run.status, 4, run.stdout + run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.status, 'error');
    assert.equal(payload.code, 'invalid_input');
});

test('TC-6.2 the CLI help lists attach with its taskId and files arguments', () => {
    const run = spawnSync(process.execPath, [join(BIN, 'huly.cjs'), 'attach', '--help'], {
        env: isolatedEnv(),
        encoding: 'utf8',
        timeout: 15_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /taskId/);
    assert.match(run.stdout, /files/);
});
