import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildTaskDetail, issueUrlWithin } from '../src/utils/task-detail.js';
import { linkLine, storageUrls } from '../src/utils/links.js';
import { getTaskInputSchema, serverOptionsFor } from '../src/mcp/get-task-schema.js';

const TASK = { _id: 'issue-1', identifier: 'DELTA-42', title: 'T', description: null };
const SYSTEM_TMP = realpathSync(tmpdir());
const REPO_ROOT = resolve(import.meta.dirname, '..');

// These tests move HOME, TMPDIR and the working directory; keep the caller's
// values and give every test the default roots.
const saved = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, cwd: process.cwd() };
const created: string[] = [];
before(() => { delete process.env.HULY_DOWNLOAD_ROOT; });
after(() => {
    restore();
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function restore() {
    process.chdir(saved.cwd);
    for (const [key, value] of [['HOME', saved.HOME], ['TMPDIR', saved.TMPDIR]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    delete process.env.HULY_DOWNLOAD_ROOT;
}

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(SYSTEM_TMP, 'huly-review-fix-')));
    created.push(dir);
    return dir;
}

function attachment(id: string, name: string, extra: Record<string, any> = {}) {
    return { _id: id, name, file: `blob-${id}`, type: 'text/plain', size: 4, lastModified: 1, ...extra };
}

function source(opts: { attachments?: any[]; blob?: (id: string) => Promise<any>; markup?: () => Promise<any>; url?: () => Promise<any> } = {}) {
    return {
        async fetchMarkup() { return opts.markup ? opts.markup() : null; },
        async getAttachments() { return opts.attachments ?? []; },
        async downloadBlob(id: string) { return opts.blob ? opts.blob(id) : Buffer.from('data'); },
        ...(opts.url ? { getIssueUrl: opts.url } : {}),
    };
}

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

async function rejectsInvalid(promise: Promise<unknown>) {
    await assert.rejects(promise, (e: any) => e?.code === 'invalid_input');
}

// --- AC-1 (R1): a working directory that is /, home or above home is not a root --

test('TC-1.1 cwd equal to home is not a download root', async () => {
    const home = tempDir();
    const elsewhere = tempDir();
    try {
        process.env.HOME = home;
        process.env.TMPDIR = elsewhere;
        process.chdir(home);
        await rejectsInvalid(buildTaskDetail(source({ attachments: [attachment('a1', 'com.x.plist')] }), TASK,
            { downloadDir: join(home, 'Library', 'LaunchAgents') }));
        assert.ok(!existsSync(join(home, 'Library')), 'nothing created under home');
    } finally {
        restore();
    }
});

test('TC-1.2 cwd / is not a download root', async () => {
    try {
        process.chdir('/');
        // The message, not just the code: a failed mkdir under / is also
        // invalid_input, and would hide a regression of the root check.
        await assert.rejects(
            buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: '/huly-review-x/y' }),
            (e: any) => e?.code === 'invalid_input' && /must be inside/.test(e.message),
        );
        assert.ok(!existsSync('/huly-review-x'));
    } finally {
        restore();
        rmSync('/huly-review-x', { recursive: true, force: true });
    }
});

test('TC-1.3 an ordinary working directory is still a root', async () => {
    const project = tempDir();
    const elsewhere = tempDir();
    try {
        process.env.TMPDIR = elsewhere;
        process.chdir(project);
        const detail = await buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: 'out' });
        assert.ok(detail.attachmentFiles[0].localPath?.startsWith(join(project, 'out')));
    } finally {
        restore();
    }
});

// --- AC-2 (R2): a timeout before the blob arrives ---------------------------

function fakeStream(chunks: string[]) {
    const stream: any = {
        destroyed: false,
        destroy() { stream.destroyed = true; },
        async *[Symbol.asyncIterator]() { for (const c of chunks) yield Buffer.from(c); },
    };
    return stream;
}

test('TC-2.1 a blob that arrives after the timeout is destroyed and leaves no file', async () => {
    const dir = tempDir();
    const late = fakeStream(['late']);
    const detail = await buildTaskDetail(
        source({ attachments: [attachment('a1', 'slow.txt')], blob: () => later(150, late) }),
        TASK, { downloadDir: dir, limits: { timeoutMs: 40 } },
    );
    assert.match(detail.attachmentFiles[0].downloadError ?? '', /time/i);
    await later(250, null);
    assert.equal(late.destroyed, true, 'late stream destroyed');
    assert.deepEqual(readdirSync(dir), []);
});

test('TC-2.2 a late blob does not take the name of the next file', async () => {
    const dir = tempDir();
    // a1 is released only once a2 has been requested, i.e. after a1 timed
    // out, so its late arrival always overlaps a2's download.
    let releaseA1!: (value: any) => void;
    const a1 = new Promise((resolve) => { releaseA1 = resolve; });
    const detail = await buildTaskDetail(
        source({
            attachments: [attachment('a1', 'spec.pdf'), attachment('a2', 'spec.pdf')],
            blob: (id) => {
                if (id === 'blob-a1') return a1;
                releaseA1(fakeStream(['old']));
                return later(20, Buffer.from('new'));
            },
        }),
        TASK, { downloadDir: dir, limits: { timeoutMs: 300 } },
    );
    await later(50, null);
    assert.equal(detail.attachmentFiles[1].downloadError, undefined);
    assert.match(detail.attachmentFiles[1].localPath ?? '', /[\\/]spec\.pdf$/);
});

// --- AC-3 (R3): a directory that cannot be created --------------------------

test('TC-3.1 a downloadDir that is a file is invalid input', async () => {
    const root = tempDir();
    const file = join(root, 'a-file');
    writeFileSync(file, 'x');
    await rejectsInvalid(buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: file }));
});

// --- AC-4 (R4): a hanging link lookup ---------------------------------------

test('TC-4.1 a link lookup that never answers yields url null in time', async () => {
    const started = Date.now();
    const detail = await buildTaskDetail(source({ url: () => new Promise(() => {}) }), TASK, { linkTimeoutMs: 100 });
    assert.equal(detail.url, null);
    assert.ok(Date.now() - started < 2000, 'returned promptly');
});

test('TC-4.2 issueUrlWithin returns the link when quick and null when it hangs', async () => {
    assert.equal(await issueUrlWithin(source({ url: async () => 'https://h/x' }), 'X', 100), 'https://h/x');
    assert.equal(await issueUrlWithin(source({ url: () => new Promise(() => {}) }), 'X', 50), null);
    assert.equal(await issueUrlWithin(source(), 'X', 50), null);
});

// --- AC-5 (R5): a description that could not be read ------------------------

test('TC-5.1 an unreadable description is reported, not passed off as empty', async () => {
    const detail: any = await buildTaskDetail(
        source({ markup: async () => { throw new Error('collaborator\n500 internal error'); } }),
        { ...TASK, description: 'ref' },
    );
    assert.equal(detail.descriptionMarkdown, null);
    assert.ok(detail.descriptionError, 'descriptionError set');
    assert.ok(!/[\r\n]/.test(detail.descriptionError), 'one line');
});

test('TC-5.2 no descriptionError when the description reads or is absent', async () => {
    const read: any = await buildTaskDetail(source({ markup: async () => '# body' }), { ...TASK, description: 'ref' });
    assert.equal(read.descriptionError, undefined);
    const none: any = await buildTaskDetail(source(), TASK);
    assert.equal(none.descriptionError, undefined);
});

// --- AC-6 (R6): ~ means home --------------------------------------------------

test('TC-6.1 a downloadDir starting with ~ resolves under home', async () => {
    const home = tempDir();
    try {
        process.env.HOME = home;
        // Run from a scratch directory: an unexpanded `~/x` would land here, not in the repo.
        process.chdir(tempDir());
        const detail = await buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: '~/x' });
        assert.ok(detail.attachmentFiles[0].localPath?.startsWith(join(home, 'x')), detail.attachmentFiles[0].localPath);
    } finally {
        restore();
    }
});

// --- AC-7 (R7): files URLs from one config and token -------------------------

test('TC-7.1 storageUrls builds the files and upload URLs from the server config', () => {
    assert.deepEqual(
        storageUrls('https://huly.example.com/', { FILES_URL: '/files/:workspace/:filename', UPLOAD_URL: '/upload/:workspace' }, 'ws-1'),
        { filesUrl: 'https://huly.example.com/files/ws-1/:filename', uploadUrl: 'https://huly.example.com/upload/ws-1' },
    );
    assert.deepEqual(
        storageUrls('https://huly.example.com', { FILES_URL: 'https://cdn.example.com/:workspace/:blobId' }, 'ws-2'),
        { filesUrl: 'https://cdn.example.com/ws-2/:blobId', uploadUrl: null },
    );
});

// --- AC-8 (R8): the Link line ------------------------------------------------

test('TC-8.1 linkLine prints the link, or nothing without one', () => {
    assert.equal(linkLine('https://h/workbench/w/tracker/D-1'), '🔗 Link: https://h/workbench/w/tracker/D-1\n');
    assert.equal(linkLine(null), '');
    assert.equal(linkLine(undefined), '');
});

// --- AC-9 (R10): write where the check looked --------------------------------

test('TC-9.1 a downloadDir through an in-root symlink writes into the real directory', async () => {
    const root = tempDir();
    const real = join(root, 'real');
    mkdirSync(real);
    const via = join(root, 'via');
    symlinkSync(real, via);
    const detail = await buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: join(via, 'out') });
    assert.ok(existsSync(join(real, 'out', 'a.txt')));
    assert.ok(detail.attachmentFiles[0].localPath?.startsWith(join(via, 'out')));
});

// --- AC-10 (R11): the older suites survive a configured root ------------------

test('TC-10.1 the attachment suites pass with HULY_DOWNLOAD_ROOT set and leave no temp dirs', () => {
    const unrelated = tempDir();
    // A private TMPDIR: other test files running in parallel create the same
    // kind of directories in the system temp dir.
    const childTmp = tempDir();
    // NODE_TEST_CONTEXT makes a nested runner report to this one and exit 0
    // whatever its tests did; drop it so the exit code is the suites' own.
    const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
    // Paths from the repo root, not the working directory, so the suite also
    // runs when started from elsewhere.
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-force-exit', 'tests/task-detail.test.ts', 'tests/task-detail-hardening.test.ts'], {
        cwd: REPO_ROOT,
        env: { ...env, HULY_DOWNLOAD_ROOT: unrelated, TMPDIR: childTmp },
        encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stdout.split('\n').filter((l) => l.startsWith('✖')).join('\n'));
    // tsx keeps its own cache (tsx-<uid>) there too; only the suites' dirs count.
    assert.deepEqual(readdirSync(childTmp).filter((n) => n.startsWith('huly-')), []);
});

// --- AC-11 (R12, R13): who may download --------------------------------------

test('TC-11.1 only the stdio transport may download, and the schema default does not', () => {
    assert.deepEqual(serverOptionsFor('http'), { allowDownloads: false });
    assert.deepEqual(serverOptionsFor('stdio'), { allowDownloads: true });
    assert.equal(getTaskInputSchema().safeParse({ taskId: 'D-1', downloadDir: './x' }).success, false);
});

test('TC-11.2 a dangling symlink in the root that points outside is refused', async () => {
    const root = tempDir();
    const outside = join(tempDir(), 'not-yet');
    const link = join(root, 'dangling');
    symlinkSync(outside, link);
    try {
        process.env.HULY_DOWNLOAD_ROOT = root;
        await rejectsInvalid(buildTaskDetail(source({ attachments: [attachment('a1', 'a.txt')] }), TASK, { downloadDir: link }));
        assert.ok(!existsSync(outside), 'target not created');
    } finally {
        restore();
    }
});
