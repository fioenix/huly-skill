import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, resolve, sep } from 'node:path';

import { buildTaskDetail, formatAttachmentLines } from '../src/utils/task-detail.js';

const TASK = {
    _id: 'issue-1',
    _class: 'tracker:class:Issue',
    identifier: 'DELTA-42',
    title: 'Fix login',
    description: 'blob-ref-desc',
    attachments: 2,
};

function attachment(id: string, name: string | undefined, extra: Record<string, any> = {}) {
    return {
        _id: id,
        _class: 'attachment:class:Attachment',
        attachedTo: 'issue-1',
        name,
        file: `blob-${id}`,
        type: 'application/pdf',
        size: 2048,
        lastModified: 1700000000000,
        ...extra,
    };
}

/** A fake client recording every call, so tests can assert what was (not) asked. */
function fakeSource(opts: {
    markdown?: string | null;
    markupError?: Error;
    attachments?: any[];
    attachmentsError?: Error;
    blobs?: Record<string, string>;
    failBlobs?: string[];
} = {}) {
    const calls = { fetchMarkup: 0, getAttachments: [] as string[], downloadBlob: [] as string[] };
    const source = {
        async fetchMarkup(_doc: any, _field: string) {
            calls.fetchMarkup++;
            if (opts.markupError) throw opts.markupError;
            return opts.markdown ?? null;
        },
        async getAttachments(issueId: string) {
            calls.getAttachments.push(issueId);
            if (opts.attachmentsError) throw opts.attachmentsError;
            return opts.attachments ?? [];
        },
        async downloadBlob(blobId: string) {
            calls.downloadBlob.push(blobId);
            if (opts.failBlobs?.includes(blobId)) throw new Error(`HTTP 404 for ${blobId}`);
            return Buffer.from(opts.blobs?.[blobId] ?? `content of ${blobId}`);
        },
    };
    return { source, calls };
}

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'huly-task-detail-'));
}

function inside(dir: string, path: string): boolean {
    return resolve(path).startsWith(resolve(dir) + sep);
}

// --- AC-1: description as markdown -----------------------------------------

test('TC-1.1 description ref is resolved to markdown and original fields are kept', async () => {
    const { source } = fakeSource({ markdown: '# Steps\n\n1. Open login' });
    const detail = await buildTaskDetail(source, TASK);
    assert.equal(detail.descriptionMarkdown, '# Steps\n\n1. Open login');
    assert.equal(detail.identifier, 'DELTA-42');
    assert.equal(detail.description, 'blob-ref-desc');
    assert.equal(detail.attachments, 2);
});

test('TC-1.2 task without a description yields null and never fetches markup', async () => {
    const { source, calls } = fakeSource({ markdown: 'unused' });
    for (const description of [null, undefined, '']) {
        const detail = await buildTaskDetail(source, { ...TASK, description });
        assert.equal(detail.descriptionMarkdown, null);
    }
    assert.equal(calls.fetchMarkup, 0);
});

test('TC-1.4 an empty markdown body is reported as null', async () => {
    const { source } = fakeSource({ markdown: '' });
    const detail = await buildTaskDetail(source, TASK);
    assert.equal(detail.descriptionMarkdown, null);
});

test('TC-1.3 a failing markup fetch yields null instead of throwing', async () => {
    const { source } = fakeSource({ markupError: new Error('500 from collaborator') });
    const detail = await buildTaskDetail(source, TASK);
    assert.equal(detail.descriptionMarkdown, null);
});

// --- AC-2: attachment metadata ---------------------------------------------

test('TC-2.1 attachments are listed with their metadata', async () => {
    const { source, calls } = fakeSource({
        attachments: [attachment('a1', 'spec.pdf'), attachment('a2', 'screen.png', { type: 'image/png', size: 10 })],
    });
    const detail = await buildTaskDetail(source, TASK);
    assert.deepEqual(calls.getAttachments, ['issue-1']);
    assert.deepEqual(detail.attachmentFiles, [
        { _id: 'a1', name: 'spec.pdf', type: 'application/pdf', size: 2048, blobId: 'blob-a1', lastModified: 1700000000000 },
        { _id: 'a2', name: 'screen.png', type: 'image/png', size: 10, blobId: 'blob-a2', lastModified: 1700000000000 },
    ]);
});

test('TC-2.2 a task with no attachments yields an empty list and no download', async () => {
    const { source, calls } = fakeSource({ attachments: [] });
    const detail = await buildTaskDetail(source, { ...TASK, attachments: 0 }, { downloadDir: tempDir() });
    assert.deepEqual(detail.attachmentFiles, []);
    assert.equal(calls.downloadBlob.length, 0);
});

test('TC-2.3 missing attachment fields become null without throwing', async () => {
    const { source } = fakeSource({
        attachments: [{ _id: 'a3', file: 'blob-a3' }],
    });
    const detail = await buildTaskDetail(source, TASK);
    assert.deepEqual(detail.attachmentFiles, [
        { _id: 'a3', name: null, type: null, size: null, blobId: 'blob-a3', lastModified: null },
    ]);
});

test('TC-2.4 a failing attachment query is surfaced, not hidden as an empty list', async () => {
    const { source } = fakeSource({ attachmentsError: new Error('connection lost') });
    await assert.rejects(() => buildTaskDetail(source, TASK), /connection lost/);
});

// --- AC-3: download on request ---------------------------------------------

test('TC-3.1 downloadDir saves every file and records an absolute localPath inside it', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'spec.pdf'), attachment('a2', 'notes.txt')],
        blobs: { 'blob-a1': 'PDF-BYTES', 'blob-a2': 'hello notes' },
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const [pdf, txt] = detail.attachmentFiles;
    for (const f of [pdf, txt]) {
        assert.ok(f.localPath, 'localPath set');
        assert.ok(isAbsolute(f.localPath!), 'localPath absolute');
        assert.ok(inside(dir, f.localPath!), 'localPath inside downloadDir');
    }
    assert.equal(readFileSync(pdf.localPath!, 'utf8'), 'PDF-BYTES');
    assert.equal(readFileSync(txt.localPath!, 'utf8'), 'hello notes');
});

test('TC-3.2 unsafe file names are sanitized and cannot escape downloadDir', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', '../../evil.sh'), attachment('a2', 'a/b.txt'), attachment('a3', ''), attachment('a4', undefined)],
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const paths = detail.attachmentFiles.map((f) => f.localPath!);
    for (const p of paths) {
        assert.ok(p, 'every file saved');
        assert.ok(inside(dir, p), `${p} stays inside ${dir}`);
    }
    assert.equal(new Set(paths).size, 4, 'distinct files');
    assert.equal(readdirSync(dir).length, 4, 'all files directly in downloadDir');
    assert.ok(!existsSync(resolve(dir, '..', '..', 'evil.sh')));
});

test('TC-3.3 files with the same name do not overwrite each other', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'spec.pdf'), attachment('a2', 'spec.pdf')],
        blobs: { 'blob-a1': 'first', 'blob-a2': 'second' },
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const [a, b] = detail.attachmentFiles;
    assert.notEqual(a.localPath, b.localPath);
    assert.equal(readFileSync(a.localPath!, 'utf8'), 'first');
    assert.equal(readFileSync(b.localPath!, 'utf8'), 'second');
});

test('TC-3.4 one failed download is reported on that entry while the rest still save', async () => {
    const dir = tempDir();
    const { source } = fakeSource({
        attachments: [attachment('a1', 'gone.pdf'), attachment('a2', 'ok.txt')],
        blobs: { 'blob-a2': 'fine' },
        failBlobs: ['blob-a1'],
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const [gone, ok] = detail.attachmentFiles;
    assert.match(gone.downloadError ?? '', /404/);
    assert.equal(gone.localPath, undefined);
    assert.equal(readFileSync(ok.localPath!, 'utf8'), 'fine');
    assert.equal(ok.downloadError, undefined);
});

test('TC-3.5 without downloadDir nothing is downloaded', async () => {
    const { source, calls } = fakeSource({ attachments: [attachment('a1', 'spec.pdf')] });
    const detail = await buildTaskDetail(source, TASK);
    assert.equal(calls.downloadBlob.length, 0);
    assert.equal(detail.attachmentFiles[0].localPath, undefined);
});

test('TC-3.6 a downloadDir that does not exist yet is created', async () => {
    const dir = join(tempDir(), 'nested', 'DELTA-42');
    const { source } = fakeSource({ attachments: [attachment('a1', 'spec.pdf')], blobs: { 'blob-a1': 'x' } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    assert.equal(readFileSync(detail.attachmentFiles[0].localPath!, 'utf8'), 'x');
});

test('TC-3.7 an entry without a blob reference gets downloadError and no storage call', async () => {
    const dir = tempDir();
    const { source, calls } = fakeSource({ attachments: [{ _id: 'a9', name: 'orphan.txt' }, attachment('a1', 'ok.txt')] });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const [orphan, ok] = detail.attachmentFiles;
    assert.ok(orphan.downloadError, 'downloadError set');
    assert.equal(orphan.localPath, undefined);
    assert.deepEqual(calls.downloadBlob, ['blob-a1']);
    assert.ok(ok.localPath);
});

test('TC-3.8 a relative downloadDir yields an absolute localPath', async () => {
    // realpath: on macOS tmpdir() is /var/… while process.cwd() reports /private/var/….
    const base = realpathSync(tempDir());
    const cwd = process.cwd();
    process.chdir(base);
    try {
        const { source } = fakeSource({ attachments: [attachment('a1', 'spec.pdf')] });
        const detail = await buildTaskDetail(source, TASK, { downloadDir: './rel' });
        const p = detail.attachmentFiles[0].localPath!;
        assert.ok(isAbsolute(p));
        assert.ok(inside(join(base, 'rel'), p));
    } finally {
        process.chdir(cwd);
    }
});

test('TC-3.9 dot names, backslashes, NUL and over-long names stay inside downloadDir', async () => {
    const dir = tempDir();
    const long = 'x'.repeat(300) + '.pdf';
    const { source } = fakeSource({
        attachments: [
            attachment('a1', '.'), attachment('a2', '..'), attachment('a3', '..\\x.txt'),
            attachment('a4', 'bad\u0000name.txt'), attachment('a5', long),
        ],
    });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const paths = detail.attachmentFiles.map((f) => f.localPath!);
    for (const p of paths) {
        assert.ok(p, 'every file saved');
        assert.ok(inside(dir, p), `${p} stays inside ${dir}`);
        assert.ok(Buffer.byteLength(p.slice(resolve(dir).length + 1)) <= 255, 'name fits 255 bytes');
    }
    assert.equal(readdirSync(dir).length, 5);
});

test('TC-3.10 downloading twice into the same directory keeps the first copy', async () => {
    const dir = tempDir();
    const first = fakeSource({ attachments: [attachment('a1', 'spec.pdf')], blobs: { 'blob-a1': 'v1' } });
    const one = await buildTaskDetail(first.source, TASK, { downloadDir: dir });
    const second = fakeSource({ attachments: [attachment('a1', 'spec.pdf')], blobs: { 'blob-a1': 'v2' } });
    const two = await buildTaskDetail(second.source, TASK, { downloadDir: dir });
    assert.notEqual(one.attachmentFiles[0].localPath, two.attachmentFiles[0].localPath);
    assert.equal(readFileSync(one.attachmentFiles[0].localPath!, 'utf8'), 'v1');
    assert.equal(readFileSync(two.attachmentFiles[0].localPath!, 'utf8'), 'v2');
});

test('TC-3.11 an empty blob still produces an empty file', async () => {
    const dir = tempDir();
    const { source } = fakeSource({ attachments: [attachment('a1', 'empty.txt')], blobs: { 'blob-a1': '' } });
    const detail = await buildTaskDetail(source, TASK, { downloadDir: dir });
    const p = detail.attachmentFiles[0].localPath!;
    assert.ok(p);
    assert.equal(readFileSync(p, 'utf8'), '');
});

// --- AC-4: text output -----------------------------------------------------

test('TC-4.1 text lines show name, type, readable size and local path when present', () => {
    const out = formatAttachmentLines([
        { _id: 'a1', name: 'spec.pdf', type: 'application/pdf', size: 2048, blobId: 'b1', lastModified: null, localPath: '/tmp/x/spec.pdf' },
        { _id: 'a2', name: 'screen.png', type: 'image/png', size: 500, blobId: 'b2', lastModified: null },
    ]);
    assert.match(out, /spec\.pdf/);
    assert.match(out, /application\/pdf/);
    assert.match(out, /2(\.0)? KB/);
    assert.match(out, /\/tmp\/x\/spec\.pdf/);
    assert.match(out, /screen\.png/);
    assert.match(out, /500 B/);
});

test('TC-4.2 no attachments prints nothing; a failed download shows its reason', () => {
    assert.equal(formatAttachmentLines([]), '');
    const out = formatAttachmentLines([
        { _id: 'a1', name: 'gone.pdf', type: null, size: null, blobId: 'b1', lastModified: null, downloadError: 'HTTP 404' },
    ]);
    assert.match(out, /gone\.pdf/);
    assert.match(out, /HTTP 404/);
});

test('TC-4.3 unknown size or type is omitted, large sizes use MB', () => {
    const unknown = formatAttachmentLines([
        { _id: 'a1', name: 'mystery', type: null, size: null, blobId: 'b1', lastModified: null },
    ]);
    assert.match(unknown, /mystery/);
    assert.doesNotMatch(unknown, /null|undefined|NaN/);
    const big = formatAttachmentLines([
        { _id: 'a2', name: 'video.mp4', type: 'video/mp4', size: 5 * 1024 * 1024, blobId: 'b2', lastModified: null },
    ]);
    assert.match(big, /5(\.0)? MB/);
});
