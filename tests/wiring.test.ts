import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

// src/client.ts and src/mcp/tools.ts import @hcengineering/text, which pnpm
// keeps out of the top-level node_modules, so tsx cannot load them. Bundling
// them here the way `pnpm build` does (pnpm puts .pnpm/node_modules on
// NODE_PATH for it) tests the real wiring rather than a copy of it.
const ROOT = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'huly-wiring-'));
let mod: any;

before(async () => {
    const out = await build({
        stdin: {
            contents: "export { registerHulyTools } from './src/mcp/tools.ts'; export { HulyClient } from './src/client.ts';",
            resolveDir: ROOT,
            loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
        nodePaths: [join(ROOT, 'node_modules/.pnpm/node_modules')],
        define: { 'import.meta.url': '"file:///bundle"', __HULY_VERSION__: '"test"' },
    });
    const file = join(scratch, 'wiring.cjs');
    writeFileSync(file, out.outputFiles[0].text);
    mod = createRequire(file)(file);
});
after(() => rmSync(scratch, { recursive: true, force: true }));

function getTaskSchema(options?: { allowDownloads: boolean }) {
    const tools = new Map<string, any>();
    mod.registerHulyTools({ registerTool: (name: string, def: any) => tools.set(name, def) }, options);
    return tools.get('huly_get_task').inputSchema;
}

test('TC-11.3 registerHulyTools offers downloadDir only when asked to', () => {
    const call = { taskId: 'D-1', downloadDir: './x' };
    assert.equal(getTaskSchema().safeParse(call).success, false, 'default: no downloads');
    assert.equal(getTaskSchema({ allowDownloads: true }).safeParse(call).success, true);
});

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', ready));
    const { port } = probe.address() as AddressInfo;
    await new Promise((closed) => probe.close(closed));
    return port;
}

// Runs the committed bundle: `pnpm build` must have run after a change to
// src/mcp/index.ts (CI rebuilds and fails on a dirty tree).
test('TC-11.4 the built MCP server offers downloadDir over stdio but not over HTTP', async () => {
    const bin = join(ROOT, 'bin/mcp.cjs');
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const hasDownloadDir = (message: any) =>
        'downloadDir' in message.result.tools.find((t: any) => t.name === 'huly_get_task').inputSchema.properties;

    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
    const stdin = [init, { jsonrpc: '2.0', method: 'notifications/initialized' }, list].map((m) => JSON.stringify(m)).join('\n') + '\n';
    const stdout = execFileSync(process.execPath, [bin], {
        input: stdin,
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 15_000,
        // The machine's own HULY_MCP_TRANSPORT must not turn this into the HTTP case.
        env: { ...process.env, HULY_MCP_TRANSPORT: 'stdio' },
    });
    const stdioList = stdout.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).find((m) => m.id === 2);
    assert.equal(hasDownloadDir(stdioList), true, 'stdio offers downloadDir');

    const port = await freePort();
    const child = spawn(process.execPath, [bin], {
        cwd: ROOT,
        env: { ...process.env, HULY_MCP_TRANSPORT: 'http', PORT: String(port), HULY_MCP_AUTH_TOKEN: '' },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
        await new Promise<void>((ready, fail) => {
            const timer = setTimeout(() => fail(new Error('HTTP server did not start')), 10_000);
            child.stderr.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(timer); ready(); } });
        });
        const body = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify(list),
        }).then((r) => r.text());
        const data = body.split('\n').find((l) => l.startsWith('data:'));
        assert.equal(hasDownloadDir(JSON.parse(data ? data.slice(5) : body)), false, 'HTTP does not offer downloadDir');
    } finally {
        child.kill();
    }
});

test('TC-11.5 getAttachments asks Huly for a stable order and a row limit', async () => {
    const client = new mod.HulyClient();
    let seen: any[] = [];
    client.client = { findAll: async (...args: any[]) => { seen = args; return []; } };
    await client.getAttachments('issue-1');
    assert.deepEqual(seen[1], { attachedTo: 'issue-1' });
    assert.deepEqual(seen[2], { sort: { modifiedOn: 1 }, limit: 500 });
});
