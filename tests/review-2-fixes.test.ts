import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { buildTaskDetail } from '../src/utils/task-detail.js';

const ROOT = resolve(import.meta.dirname, '..');
const SYSTEM_TMP = realpathSync(tmpdir());
const TASK = { _id: 'issue-1', identifier: 'DELTA-42', title: 'T', description: null };

const saved = {
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ROOT: process.env.HULY_DOWNLOAD_ROOT,
    host: process.env.HULY_HOST,
    workspace: process.env.HULY_WORKSPACE_ID,
    key: process.env.HULY_API_KEY,
    cwd: process.cwd(),
};
const created: string[] = [];

function setOrDelete(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

function restore() {
    process.chdir(saved.cwd);
    setOrDelete('HOME', saved.HOME);
    setOrDelete('TMPDIR', saved.TMPDIR);
    delete process.env.HULY_DOWNLOAD_ROOT;
}

before(() => { delete process.env.HULY_DOWNLOAD_ROOT; });
after(() => {
    restore();
    setOrDelete('HULY_DOWNLOAD_ROOT', saved.ROOT);
    setOrDelete('HULY_HOST', saved.host);
    setOrDelete('HULY_WORKSPACE_ID', saved.workspace);
    setOrDelete('HULY_API_KEY', saved.key);
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(SYSTEM_TMP, 'huly-review2-')));
    created.push(dir);
    return dir;
}

function source(attachments: any[] = []) {
    return {
        async fetchMarkup() { return null; },
        async getAttachments() { return attachments; },
        async downloadBlob() { return Buffer.from('data'); },
    };
}

const attachment = { _id: 'a1', name: 'a.txt', file: 'blob-a1', type: 'text/plain', size: 4, lastModified: 1 };

// --- AC-1 (R4): a hanging lookup does not keep the process alive --------------

test('TC-1.1 pending lookup timers do not hold the process open', () => {
    const script = [
        "import { withTimeout, issueUrlWithin } from './src/utils/task-detail.ts';",
        "withTimeout(new Promise(() => {}), 30_000, 'slow').catch(() => {});",
        "await issueUrlWithin({ getIssueUrl: () => new Promise(() => {}) }, 'X', 50);",
        "console.log('done');",
    ].join('\n');
    const started = Date.now();
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: ROOT, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.stdout.trim(), 'done');
    assert.equal(run.status, 0, `exited with ${run.status} after ${Date.now() - started} ms`);
    assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
});

// --- AC-2 (R21): the error says why the working directory was not a root -----

test('TC-2.1 refusing a home working directory says so', async () => {
    const home = tempDir();
    try {
        process.env.HOME = home;
        process.env.TMPDIR = tempDir();
        process.chdir(home);
        await assert.rejects(
            buildTaskDetail(source([attachment]), TASK, { downloadDir: 'files' }),
            (e: any) => e?.code === 'invalid_input' && /working directory/i.test(e.message),
        );
    } finally {
        restore();
    }
});

test('TC-2.2 an ordinary refusal does not blame the working directory', async () => {
    const project = tempDir();
    try {
        process.env.TMPDIR = tempDir();
        process.chdir(project);
        await assert.rejects(
            buildTaskDetail(source([attachment]), TASK, { downloadDir: '/huly-review2-outside/x' }),
            (e: any) => e?.code === 'invalid_input' && !/working directory/i.test(e.message),
        );
    } finally {
        restore();
    }
});

// --- AC-3 (R27): HULY_DOWNLOAD_ROOT with ~, and the shared workspace lookup --

test('TC-3.1 HULY_DOWNLOAD_ROOT starting with ~ means home', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'x'));
    try {
        process.env.HOME = home;
        process.env.HULY_DOWNLOAD_ROOT = '~/x';
        process.chdir(tempDir());
        const detail = await buildTaskDetail(source([attachment]), TASK, { downloadDir: join(home, 'x', 'out') });
        assert.ok(detail.attachmentFiles[0].localPath?.startsWith(join(home, 'x', 'out')));
    } finally {
        restore();
    }
});

// HulyClient, bundled with a fake @hcengineering/api-client that counts calls.
const fake: any = (globalThis as any).__hulyFakeApi = {
    calls: { config: 0, token: 0, storage: [] as any[] },
    token: async () => ({ token: 'ws-token', workspaceId: 'ws-1', info: { workspaceUrl: 'acme' } }),
    connect: async () => ({}),
    NodeWebSocketFactory: {},
    async loadServerConfig() {
        fake.calls.config++;
        return { FILES_URL: '/files/:workspace/:blobId', UPLOAD_URL: '/upload/:workspace', ACCOUNTS_URL: '/accounts' };
    },
    async getWorkspaceToken(_url: string, _options: any, config: any) {
        fake.calls.token++;
        fake.calls.tokenConfig = config;
        return fake.token();
    },
    createStorageClient(filesUrl: string, uploadUrl: string, token: string, workspace: string) {
        fake.calls.storage.push([filesUrl, uploadUrl, token, workspace]);
        return { get: async () => [Buffer.from('blob')] };
    },
};
let HulyClient: any;

before(async () => {
    const scratch = tempDir();
    const fakeModule = join(scratch, 'fake-api-client.cjs');
    writeFileSync(fakeModule, 'module.exports = globalThis.__hulyFakeApi;\n');
    const out = await build({
        entryPoints: [join(ROOT, 'src/client.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
        nodePaths: [join(ROOT, 'node_modules/.pnpm/node_modules')],
        define: { 'import.meta.url': '"file:///bundle"', __HULY_VERSION__: '"test"' },
        plugins: [{
            name: 'fake-api-client',
            setup(b) { b.onResolve({ filter: /^@hcengineering\/api-client$/ }, () => ({ path: fakeModule })); },
        }],
    });
    const file = join(scratch, 'client.cjs');
    writeFileSync(file, out.outputFiles[0].text);
    HulyClient = createRequire(file)(file).HulyClient;
    process.env.HULY_HOST = 'https://huly.test';
    process.env.HULY_WORKSPACE_ID = 'ws-1';
    process.env.HULY_API_KEY = 'test-only-token';
});

function resetFake(token = async () => ({ token: 'ws-token', workspaceId: 'ws-1', info: { workspaceUrl: 'acme' } })) {
    fake.calls = { config: 0, token: 0, storage: [] };
    fake.token = token;
}

test('TC-3.2 the link and the files client share one config fetch and workspace selection', async () => {
    resetFake();
    const client = new HulyClient();
    assert.equal(await client.getIssueUrl('DELTA-1'), 'https://huly.test/workbench/acme/tracker/DELTA-1');
    await client.downloadBlob('0f2c9a4e-5b8d-4c1e');
    assert.equal(fake.calls.config, 1);
    assert.equal(fake.calls.token, 1);
    assert.ok(fake.calls.tokenConfig?.FILES_URL, 'the fetched config is passed on, not fetched again');
    assert.deepEqual(fake.calls.storage, [['https://huly.test/files/ws-1/:blobId', 'https://huly.test/upload/ws-1', 'ws-token', 'ws-1']]);
});

test('TC-3.3 a failed workspace selection is retried, a hanging one times out', async () => {
    let attempt = 0;
    resetFake(() => {
        attempt++;
        if (attempt === 1) return Promise.reject(new Error('ECONNRESET'));
        if (attempt === 2) return new Promise(() => {});
        return Promise.resolve({ token: 't', workspaceId: 'ws-1', info: { workspaceUrl: 'acme' } });
    });
    const client = new HulyClient();
    client.workspaceTimeoutMs = 50;
    // A real hanging load waits on a socket, which keeps the process alive
    // until the (unref'd) timeout fires. This fake hang has no I/O, so hold
    // the event loop open for it; otherwise Node 22 ends the test file early.
    const keepAlive = setInterval(() => {}, 1_000);
    try {
        await assert.rejects(client.getIssueUrl('D-1'), /ECONNRESET/);
        await assert.rejects(client.getIssueUrl('D-1'), /Timed out/);
        assert.equal(await client.getIssueUrl('D-1'), 'https://huly.test/workbench/acme/tracker/D-1');
        assert.equal(attempt, 3);
    } finally {
        clearInterval(keepAlive);
    }
});

test('TC-3.4 disconnect drops the workspace token', async () => {
    resetFake();
    const client = new HulyClient();
    await client.getIssueUrl('D-1');
    await client.disconnect();
    await client.getIssueUrl('D-1');
    assert.equal(fake.calls.token, 2);
});

// --- AC-4 (R20): the docs state the working-directory exception ------------------

test('TC-4.1 every place that documents the default roots names the / and home exception', () => {
    for (const file of ['AGENTS.md', 'skills/huly-skill/references/setup.md', '.env.example', 'skills/huly-skill/references/commands.md']) {
        const text = readFileSync(join(ROOT, file), 'utf8');
        assert.match(text, /HULY_DOWNLOAD_ROOT/, file);
        assert.match(text, /unless it is `?\/`? or (the )?home/i, `${file} names the exception`);
    }
    assert.match(readFileSync(join(ROOT, 'skills/huly-skill/SKILL.md'), 'utf8'), /descriptionError/);
});

// --- AC-5 (R22–R26): the attachment suites hold up on an unfriendly machine ---

// The child runs from a scratch directory, where a bare `tsx` would not resolve.
const TSX = pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('tsx')).href;

/** The child's own exit code: NODE_TEST_CONTEXT would make it report to us and exit 0. */
function childEnv(extra: Record<string, string>) {
    const { NODE_TEST_CONTEXT: _ignored, ...base } = process.env;
    return { ...base, ...extra };
}

test('TC-5.1 the suites pass with HTTP transport and a foreign download root preset, leaving no litter', () => {
    const childTmp = tempDir();
    const scratchCwd = tempDir();
    const run = spawnSync(process.execPath, [
        '--import', TSX, '--test', '--test-timeout=20000', '--test-force-exit',
        join(ROOT, 'tests/review-fixes.test.ts'), join(ROOT, 'tests/wiring.test.ts'),
    ], {
        cwd: scratchCwd,
        env: childEnv({ HULY_MCP_TRANSPORT: 'http', HULY_DOWNLOAD_ROOT: tempDir(), TMPDIR: childTmp }),
        encoding: 'utf8',
        timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stdout.split('\n').filter((l) => l.startsWith('✖')).join('\n') || `signal ${run.signal}`);
    assert.deepEqual(readdirSync(childTmp).filter((n) => n.startsWith('huly-')), []);
    assert.deepEqual(readdirSync(scratchCwd), [], 'nothing written into the working directory');
});

test('TC-5.2 the late-blob test is stable across repeated runs', () => {
    for (let i = 0; i < 10; i++) {
        const run = spawnSync(process.execPath, [
            '--import', 'tsx', '--test', '--test-force-exit', '--test-name-pattern=TC-2.2 a late blob',
            join(ROOT, 'tests/review-fixes.test.ts'),
        ], { cwd: ROOT, env: childEnv({}), encoding: 'utf8', timeout: 60_000 });
        assert.equal(run.status, 0, `run ${i + 1}: ${run.stdout.split('\n').filter((l) => l.startsWith('✖')).join('\n')}`);
    }
});
