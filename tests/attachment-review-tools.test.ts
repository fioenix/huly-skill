import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Review-1 fixes that need the built bundles (mcp/tools.ts loads only there).
const ROOT = resolve(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin');

const created: string[] = [];
const children: ChildProcess[] = [];
after(() => {
    for (const child of children) child.kill();
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-review-bin-')));
    created.push(dir);
    return dir;
}

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        HULY_HOST: 'http://127.0.0.1:9',
        HULY_WORKSPACE_ID: '00000000-0000-0000-0000-000000000000',
        HULY_API_KEY: 'test-token-not-real',
        HULY_MCP_AUTH_TOKEN: '',
        HULY_REQUIRE_CALLER_TOKEN: 'false',
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

/** Run one tools/call over stdio and return its JSON-RPC result. */
async function stdioCall(env: Record<string, string>, name: string, args: object): Promise<any> {
    const child = spawn(process.execPath, [join(BIN, 'mcp.cjs')], {
        env: isolatedEnv({ HULY_MCP_TRANSPORT: 'stdio', ...env }),
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    const send = (msg: object) => child.stdin!.write(`${JSON.stringify(msg)}\n`);
    return await new Promise((done, reject) => {
        const timer = setTimeout(() => reject(new Error('stdio server did not answer tools/call')), 15_000);
        let buffer = '';
        child.stdout!.on('data', (chunk) => {
            buffer += chunk.toString();
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const msg = JSON.parse(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
                if (msg.id === 1) {
                    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
                    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
                } else if (msg.id === 2) {
                    clearTimeout(timer);
                    child.kill();
                    done(msg);
                }
            }
        });
        child.on('error', reject);
        send(INIT);
    });
}

async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((done) => probe.close(() => done()));
    return port;
}

test('TC-8.2 over stdio huly_add_attachment refuses a path outside the root as invalid_input before connecting', async () => {
    const root = tempDir();
    const outside = join(tempDir(), 'x.txt');
    writeFileSync(outside, 'x');
    const reply = await stdioCall({ HULY_UPLOAD_ROOT: root }, 'huly_add_attachment', { taskId: 'DELTA-1', paths: [outside] });
    assert.equal(reply.result.isError, true);
    const payload = JSON.parse(reply.result.content[0].text);
    assert.equal(payload.status, 'error');
    assert.equal(payload.code, 'invalid_input');
});

test('TC-8.3 over HTTP calling huly_add_attachment says the tool does not exist', async () => {
    const root = tempDir();
    const path = join(root, 'secret.txt');
    writeFileSync(path, 'top secret');
    const port = await freePort();
    const child = spawn(process.execPath, [join(BIN, 'mcp.cjs')], {
        env: isolatedEnv({ HULY_MCP_TRANSPORT: 'http', PORT: String(port), HULY_UPLOAD_ROOT: root }),
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
    });
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'huly_add_attachment', arguments: { taskId: 'DELTA-1', paths: [path] } },
        }),
    });
    const text = await res.text();
    // A registered tool would answer with its own envelope: invalid_input for a
    // refused path, connection once it tried to reach the dummy host.
    assert.match(text, /huly_add_attachment not found|Tool .*not found/i, text.slice(0, 300));
    assert.doesNotMatch(text, /invalid_input|"connection"/);
    assert.ok(!text.includes('top secret'));
});

test('TC-9.1 the upload tests pass with a HULY_UPLOAD_ROOT already set in the environment', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/attachment-upload.test.ts'], {
        cwd: ROOT,
        env: { ...process.env, HULY_UPLOAD_ROOT: '/nonexistent-huly-upload-root' },
        encoding: 'utf8',
        timeout: 60_000,
    });
    assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
});
