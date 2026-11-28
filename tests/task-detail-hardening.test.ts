import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, relative } from 'node:path';

// client.ts and mcp/tools.ts import @hcengineering/text, which resolves only
// inside the esbuild bundle, so these tests reach their logic through the
// light modules those files delegate to.
import { ATTACHMENT_QUERY, buildTaskDetail, formatAttachmentLines, memoizeSuccess } from '../src/utils/task-detail.js';
import { getTaskInputSchema } from '../src/mcp/get-task-schema.js';

const TASK = { _id: 'issue-1', identifier: 'DELTA-42', title: 'T', description: null };

const created: string[] = [];
after(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-hardening-')));
    created.push(dir);
    return dir;
}

function attachment(id: string, name: string | undefined, extra: Record<string, any> = {}) {
    return { _id: id, name, file: `blob-${id}`, type: 'text/plain', size: 4, lastModified: 1, ...extra };
}

function fakeSource(opts: {
    attachments?: any[];
    blobs?: Record<string, any>;
    errors?: Record<string, any>;
} = {}) {
    const calls: string[] = [];
    const source = {
        async fetchMarkup() { return null; },
        async getAttachments() { return opts.attachments ?? []; },
        async downloadBlob(blobId: string) {
            calls.push(blobId);
            if (opts.errors?.[blobId]) throw opts.errors[blobId];
            const blob = opts.blobs?.[blobId];
            if (blob === undefined) return Buffer.from('data');
            return typeof blob === 'string' ? Buffer.from(blob) : blob;
        },
    };
    return { source, calls };
}

async function* chunks(parts: string[]) {
    for (const p of parts) yield Buffer.from(p);
}

async function* endless() {
    for (;;) yield Buffer.alloc(1024, 120);
}

function stalled(): AsyncIterable<Buffer> {
    return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Buffer>>(() => {}) }) };
}

function inside(dir: string, path: string): boolean {
    const rel = relative(realpathSync(dir), resolve(path));
    return !!rel && !rel.startsWith('..') && !rel.includes(sep);
}

async function rejectsInvalid(promise: Promise<unknown>) {
    await assert.rejects(promise, (e: any) => e?.code === 'invalid_input');
}

// --- AC-1: downloadDir confinement and HTTP gating -------------------------

test('TC-1.1 a directory inside the temp root is accepted', async () => {
    const dir = join(tempDir(), 'out');
    const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.ok(detail.attachmentFiles[0].localPath);
    assert.ok(inside(dir, detail.attachmentFiles[0].localPath!));
});

test('TC-1.2 an absolute directory outside every root is rejected before anything is created', async () => {
    const target = '/huly-hardening-should-not-exist/x';
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
    await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: target }));
    assert.ok(!existsSync('/huly-hardening-should-not-exist'));
    assert.equal(calls.length, 0);
});

test('TC-1.3 a parent traversal out of the root is rejected', async () => {
    const base = tempDir();
    const cwd = process.cwd();
    process.chdir(base);
    try {
        const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
        const up = '../'.repeat(base.split(sep).length + 2) + 'etc/huly-x';
        await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: up }));
    } finally {
        process.chdir(cwd);
    }
});

test('TC-1.4 a symlink inside the root that points outside is rejected', async () => {
    const root = tempDir();
    const link = join(root, 'escape');
    symlinkSync('/', link);
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
    await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: join(link, 'huly-x') }));
    assert.equal(calls.length, 0);
});

test('TC-1.5 a hidden directory inside the root is rejected', async () => {
    const root = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'post-checkout')] });
    await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: join(root, '.git', 'hooks') }));
    assert.ok(!existsSync(join(root, '.git')));
});

test('TC-1.6 HULY_DOWNLOAD_ROOT replaces the default roots', async () => {
    const root = tempDir();
    const other = tempDir();
    const previous = process.env.HULY_DOWNLOAD_ROOT;
    process.env.HULY_DOWNLOAD_ROOT = root;
    try {
        const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
        const ok = await buildTaskDetail(source, TASK, { downloadDir: join(root, 'in') });
        assert.ok(ok.attachmentFiles[0].localPath);
        await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: join(other, 'out') }));
    } finally {
        if (previous === undefined) delete process.env.HULY_DOWNLOAD_ROOT;
        else process.env.HULY_DOWNLOAD_ROOT = previous;
    }
});

test('TC-1.7 huly_get_task takes downloadDir over stdio but not over HTTP', () => {
    const schemas = (allowDownloads: boolean) => getTaskInputSchema(allowDownloads);
    assert.equal(schemas(true).safeParse({ taskId: 'DELTA-1', downloadDir: './x' }).success, true);
    assert.equal(schemas(false).safeParse({ taskId: 'DELTA-1', downloadDir: './x' }).success, false);
    assert.equal(schemas(false).safeParse({ taskId: 'DELTA-1' }).success, true);
});

// --- AC-2: names that are long, colliding or odd ---------------------------

test('TC-2.1 colliding 255-byte names finish and stay distinct', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'x'.repeat(260) + '_v1.pdf'), attachment('a2', 'x'.repeat(260) + '_v2.pdf')],
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const names = readdirSync(dir);
    assert.equal(names.length, 2);
    for (const n of names) assert.ok(Buffer.byteLength(n) <= 255, `${n.length} fits`);
    assert.notEqual(detail.attachmentFiles[0].localPath, detail.attachmentFiles[1].localPath);
});

test('TC-2.2 254-byte names, long extensions and many repeats all finish distinct', async () => {
    const dir = tempDir();
    const names = ['a'.repeat(250) + '.pdf', 'a.' + 'b'.repeat(253)];
    const attachments = [];
    for (let i = 0; i < 12; i++) attachments.push(attachment(`r${i}`, names[i % 2]));
    const { source } = fakeSource({ attachments });
    await buildTaskDetail(source, TASK, { downloadDir: dir });
    const onDisk = readdirSync(dir);
    assert.equal(onDisk.length, 12);
    for (const n of onDisk) assert.ok(Buffer.byteLength(n) <= 255);
});

test('TC-2.3 truncating emoji names never splits a character', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', '🔥'.repeat(70) + '.pdf'), attachment('a2', '🔥'.repeat(70) + '.pdf')] });
    await buildTaskDetail(source, TASK, { downloadDir: dir });
    const onDisk = readdirSync(dir);
    assert.equal(onDisk.length, 2);
    for (const n of onDisk) {
        assert.ok(!n.includes('�'), 'no replacement char');
        assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(n), 'no lone surrogate');
        assert.ok(Buffer.byteLength(n) <= 255);
    }
});

test('TC-2.4 fallback, leading dots, Windows-illegal and reserved names are cleaned', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [
            // The blob id must stay valid here: only the fallback name is under test.
            attachment('id\u0000with-nul', '', { file: 'blob-nul' }),
            attachment('b', '. foo.txt'),
            attachment('c', 'a:b*c?.txt'),
            attachment('d', 'NUL.txt'),
            attachment('e', 'name. '),
        ],
    });
    await buildTaskDetail(source, TASK, { downloadDir: dir });
    const onDisk = readdirSync(dir);
    assert.equal(onDisk.length, 5);
    for (const n of onDisk) {
        assert.ok(!/[\u0000-\u001f\u007f:*?"<>|\\/]/.test(n), `${JSON.stringify(n)} clean`);
        assert.equal(n, n.trim(), 'no surrounding spaces');
        assert.ok(!/[. ]$/.test(n), 'no trailing dot or space');
        assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n), `${n} not reserved`);
    }
});

test('TC-2.5 a whitespace-only downloadDir is invalid input', async () => {
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'a.txt')] });
    await rejectsInvalid(buildTaskDetail(source, TASK, { downloadDir: '   ' }));
    assert.equal(calls.length, 0);
});

// --- AC-3: blob ids --------------------------------------------------------

test('TC-3.1 blob ids carrying path or URL syntax are refused without a request', async () => {
    const dir = tempDir();
    const bad = ['../x', 'a/b', 'a?b', 'a#b', 'a&b', 'a b', '.', '@x', 'a\\b', 'a\u0000b'];
    const { source, calls } = fakeSource({ attachments: bad.map((b, i) => attachment(`b${i}`, `f${i}.txt`, { file: b })) });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.equal(calls.length, 0);
    for (const f of detail.attachmentFiles) {
        assert.ok(f.downloadError, `${f.blobId} refused`);
        assert.equal(f.localPath, undefined);
    }
});

test('TC-3.2 an ordinary blob id downloads', async () => {
    const dir = tempDir();
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'a.txt', { file: '0f2c9a4e-5b8d-4c1e-9a7b-2d3e4f5a6b7c' })] });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.deepEqual(calls, ['0f2c9a4e-5b8d-4c1e-9a7b-2d3e4f5a6b7c']);
    assert.ok(detail.attachmentFiles[0].localPath);
});

// --- AC-4: streaming with limits -------------------------------------------

test('TC-4.1 a streamed blob is written in full', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')], blobs: { 'blob-a1': chunks(['hel', 'lo ', 'world']) } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.equal(readFileSync(detail.attachmentFiles[0].localPath!, 'utf8'), 'hello world');
});

test('TC-4.2 a stream over the per-file cap is cut, its partial file removed, the next still saved', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'big.bin', { size: null }), attachment('a2', 'ok.txt')],
        blobs: { 'blob-a1': endless(), 'blob-a2': 'fine' },
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir, limits: { maxFileBytes: 10_000 } });
    const [big, ok] = detail.attachmentFiles;
    assert.ok(big.downloadError);
    assert.equal(big.localPath, undefined);
    assert.ok(!readdirSync(dir).includes('big.bin'));
    assert.equal(readFileSync(ok.localPath!, 'utf8'), 'fine');
});

test('TC-4.3 the total cap stops later files', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'one.txt', { size: null }), attachment('a2', 'two.txt', { size: null })],
        blobs: { 'blob-a1': 'x'.repeat(800), 'blob-a2': 'y'.repeat(800) },
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir, limits: { maxTotalBytes: 1000 } });
    assert.ok(detail.attachmentFiles[0].localPath);
    assert.ok(detail.attachmentFiles[1].downloadError);
    assert.deepEqual(readdirSync(dir), ['one.txt']);
});

test('TC-4.4 a stalled stream times out and leaves no file', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'slow.txt')], blobs: { 'blob-a1': stalled() } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir, limits: { timeoutMs: 100 } });
    assert.match(detail.attachmentFiles[0].downloadError ?? '', /time/i);
    assert.deepEqual(readdirSync(dir), []);
});

test('TC-4.5 a declared size over the cap is skipped without downloading', async () => {
    const dir = tempDir();
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'huge.mp4', { size: 5_000_000 })] });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir, limits: { maxFileBytes: 1_000_000 } });
    assert.equal(calls.length, 0);
    assert.ok(detail.attachmentFiles[0].downloadError);
});

// --- AC-5: storage connection cache ----------------------------------------

test('TC-5.1 a failed connection is retried on the next call', async () => {
    let attempts = 0;
    const get = memoizeSuccess(async () => {
        attempts++;
        if (attempts === 1) throw new Error('ECONNRESET');
        return 'storage';
    });
    await assert.rejects(get(), /ECONNRESET/);
    assert.equal(await get(), 'storage');
    assert.equal(attempts, 2);
});

test('TC-5.2 a successful connection is reused', async () => {
    let attempts = 0;
    const get = memoizeSuccess(async () => { attempts++; return 'storage'; });
    await get();
    await get();
    assert.equal(attempts, 1);
});

// --- AC-6: download error text ---------------------------------------------

test('TC-6.1 a long multi-line error body is reduced to one short line', async () => {
    const dir = tempDir();
    const html = '<html>\n<body>\r\n' + 'Bad gateway '.repeat(2500) + '\u001b[31m</body></html>';
    const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')], errors: { 'blob-a1': new Error(html) } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const err = detail.attachmentFiles[0].downloadError!;
    assert.ok(err.length <= 200, `length ${err.length}`);
    assert.ok(!/[\u0000-\u001f\u007f]/.test(err));
});

test('TC-6.2 an empty error message falls back to the error name', async () => {
    const dir = tempDir();
    const e = new Error('');
    e.name = 'NotFoundError';
    const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')], errors: { 'blob-a1': e } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.match(detail.attachmentFiles[0].downloadError!, /NotFoundError/);
});

// --- AC-7: numeric metadata ------------------------------------------------

test('TC-7.1 non-finite or negative size and lastModified become null', async () => {
    const { source } = fakeSource({
        attachments: [
            attachment('a1', 'a', { size: NaN, lastModified: NaN }),
            attachment('a2', 'b', { size: -1, lastModified: Infinity }),
            attachment('a3', 'c', { size: Infinity }),
        ],
    });
    const detail = await buildTaskDetail(source, TASK);
    for (const f of detail.attachmentFiles) assert.equal(f.size, null);
    assert.equal(detail.attachmentFiles[0].lastModified, null);
    assert.equal(detail.attachmentFiles[1].lastModified, null);
    assert.doesNotMatch(formatAttachmentLines(detail.attachmentFiles), /NaN|Infinity|-1 B/);
});

// --- AC-8: attachment query ------------------------------------------------

test('TC-8.1 the attachment query asks for a stable order and a row limit', () => {
    assert.ok(ATTACHMENT_QUERY.sort && Object.keys(ATTACHMENT_QUERY.sort).length > 0, 'sort set');
    assert.ok(typeof ATTACHMENT_QUERY.limit === 'number' && ATTACHMENT_QUERY.limit > 0, 'limit set');
});

test('TC-8.2 same-named files keep the order the query returned', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'spec.pdf'), attachment('a2', 'spec.pdf')] });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.match(detail.attachmentFiles[0].localPath!, /[\\/]spec\.pdf$/);
    assert.match(detail.attachmentFiles[1].localPath!, /[\\/]spec-1\.pdf$/);
});

// --- happy paths that must stay untouched ----------------------------------

test('TC-2.6 an ordinary name is kept as is', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'report.pdf')] });
    await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.deepEqual(readdirSync(dir), ['report.pdf']);
});

test('TC-6.3 a short one-line error is kept as is', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'a.txt')], errors: { 'blob-a1': new Error('HTTP 404') } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.equal(detail.attachmentFiles[0].downloadError, 'HTTP 404');
});

test('TC-7.2 valid size and lastModified are kept', async () => {
    const { source } = fakeSource({ attachments: [attachment('a1', 'a', { size: 2048, lastModified: 1700000000000 })] });
    const detail = await buildTaskDetail(source, TASK);
    assert.equal(detail.attachmentFiles[0].size, 2048);
    assert.equal(detail.attachmentFiles[0].lastModified, 1700000000000);
});
