import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { attachPrepared, blobObjectName, mimeTypeFor, prepareUploads, UPLOAD_LIMITS } from '../src/utils/attachment-upload.js';
import { isSafeBlobId } from '../src/utils/task-detail.js';
import { addAttachmentInputSchema } from '../src/mcp/attachment-schema.js';

const created: string[] = [];
after(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
// The temp directory is no longer a default upload root, and the machine
// running the tests may have its own HULY_UPLOAD_ROOT: pin it for every test.
beforeEach(() => {
    process.env.HULY_UPLOAD_ROOT = realpathSync(tmpdir());
});
afterEach(() => {
    delete process.env.HULY_UPLOAD_ROOT;
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-upload-')));
    created.push(dir);
    return dir;
}

function file(dir: string, name: string, content: string | Buffer = 'abc'): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
}

function isInvalid(e: any): boolean {
    return e?.code === 'invalid_input';
}

const TASK = { _id: 'issue-1', identifier: 'DELTA-42', space: 'project-1' };

/** A fake Huly client recording every call, so tests can assert what was (not) sent. */
function fakeSource(opts: {
    task?: any;
    uploadErrors?: Record<string, Error>;
    addErrors?: Record<string, Error>;
    removeError?: Error;
} = {}) {
    const calls = {
        getTask: [] as string[],
        uploadBlob: [] as { key: string; name: string; data: Buffer; type: string }[],
        removeBlob: [] as string[],
        addIssueAttachment: [] as { task: any; attrs: any }[],
    };
    let next = 0;
    const source = {
        async getTask(taskId: string) {
            calls.getTask.push(taskId);
            return opts.task === undefined ? TASK : opts.task;
        },
        async uploadBlob({ key, name, data, type }: { key: string; name: string; data: Buffer; type: string }) {
            calls.uploadBlob.push({ key, name, data, type });
            if (opts.uploadErrors?.[name]) throw opts.uploadErrors[name];
            return { _id: `blob-${++next}` };
        },
        async removeBlob(blobId: string) {
            calls.removeBlob.push(blobId);
            if (opts.removeError) throw opts.removeError;
        },
        async addIssueAttachment(task: any, attrs: any) {
            calls.addIssueAttachment.push({ task, attrs });
            if (opts.addErrors?.[attrs.name]) throw opts.addErrors[attrs.name];
            return `att-${attrs.file}`;
        },
    };
    return { source, calls };
}

async function attach(paths: string[], opts: Parameters<typeof fakeSource>[0] = {}) {
    const fake = fakeSource(opts);
    const result = await attachPrepared(fake.source, 'DELTA-42', await prepareUploads(paths));
    return { result, calls: fake.calls };
}

// --- AC-1: a valid file is sent and recorded --------------------------------

test('TC-1.1 a file is sent with its name, type and bytes, and recorded on the issue', async () => {
    const dir = tempDir();
    const path = file(dir, 'report.pdf', 'pdf');
    const { result, calls } = await attach([path]);

    assert.equal(calls.uploadBlob.length, 1);
    assert.equal(calls.uploadBlob[0].name, 'report.pdf');
    assert.equal(calls.uploadBlob[0].type, 'application/pdf');
    assert.deepEqual([...calls.uploadBlob[0].data], [...Buffer.from('pdf')]);

    assert.equal(calls.addIssueAttachment.length, 1);
    assert.equal(calls.addIssueAttachment[0].task._id, 'issue-1');
    assert.deepEqual(calls.addIssueAttachment[0].attrs, {
        name: 'report.pdf',
        file: 'blob-1',
        type: 'application/pdf',
        size: 3,
        lastModified: Math.round(statSync(path).mtimeMs),
    });

    assert.equal(result.taskId, 'DELTA-42');
    assert.equal(result.uploaded, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.files[0].attachmentId, 'att-blob-1');
    assert.equal(result.files[0].blobId, 'blob-1');
    assert.equal(result.files[0].path, path);
    assert.equal(result.files[0].uploadError, undefined);
});

test('TC-1.2 several files are sent in the order given', async () => {
    const dir = tempDir();
    const { result, calls } = await attach([file(dir, 'b.txt'), file(dir, 'a.txt')]);
    assert.deepEqual(calls.uploadBlob.map((c) => c.name), ['b.txt', 'a.txt']);
    assert.equal(result.uploaded, 2);
    assert.equal(result.failed, 0);
});

test('TC-1.3 the type comes from the extension, case-insensitively, else octet-stream', () => {
    assert.equal(mimeTypeFor('SHOT.PNG'), 'image/png');
    assert.equal(mimeTypeFor('Makefile'), 'application/octet-stream');
    assert.equal(mimeTypeFor('data.qqq'), 'application/octet-stream');
});

test('TC-1.4 an empty file is accepted with size 0', async () => {
    const dir = tempDir();
    const { calls } = await attach([file(dir, 'empty.txt', '')]);
    assert.equal(calls.addIssueAttachment[0].attrs.size, 0);
});

test('TC-1.5 a symlink to a file inside the root is accepted under the link name', async () => {
    const dir = tempDir();
    const target = file(dir, 'real.txt');
    const link = join(dir, 'alias.txt');
    symlinkSync(target, link);
    const { calls } = await attach([link]);
    assert.equal(calls.uploadBlob[0].name, 'alias.txt');
});

test('TC-1.6 a name with spaces and Unicode is kept as is', async () => {
    const dir = tempDir();
    const { calls } = await attach([file(dir, 'Báo cáo tuần.pdf')]);
    assert.equal(calls.uploadBlob[0].name, 'Báo cáo tuần.pdf');
    assert.equal(calls.addIssueAttachment[0].attrs.name, 'Báo cáo tuần.pdf');
});

test('TC-1.7 the storage key is a fresh UUID, never the file name', () => {
    // The upload endpoint stores a blob under the key it is given, so a shared
    // name would make two uploads overwrite each other.
    const keys = new Set(Array.from({ length: 50 }, () => blobObjectName()));
    assert.equal(keys.size, 50);
    for (const key of keys) {
        assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.ok(isSafeBlobId(key));
    }
});

// --- AC-2: only files inside an allowed root are read ----------------------

test('TC-2.1 a file outside HULY_UPLOAD_ROOT is rejected', async () => {
    const root = tempDir();
    const elsewhere = tempDir();
    process.env.HULY_UPLOAD_ROOT = root;
    await assert.rejects(prepareUploads([file(elsewhere, 'x.txt')]), isInvalid);
});

test('TC-2.2 a hidden file or a file in a hidden directory is rejected', async () => {
    const dir = tempDir();
    await assert.rejects(prepareUploads([file(dir, '.env', 'SECRET=1')]), isInvalid);
    mkdirSync(join(dir, '.ssh'));
    await assert.rejects(prepareUploads([file(join(dir, '.ssh'), 'id_rsa')]), isInvalid);
});

test('TC-2.3 a symlink inside the root pointing outside it is rejected', async () => {
    const root = tempDir();
    const outside = file(tempDir(), 'secret.txt');
    process.env.HULY_UPLOAD_ROOT = root;
    const link = join(root, 'link.txt');
    symlinkSync(outside, link);
    await assert.rejects(prepareUploads([link]), isInvalid);
});

test('TC-2.4 a directory or a missing file is rejected', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'folder'));
    await assert.rejects(prepareUploads([join(dir, 'folder')]), isInvalid);
    await assert.rejects(prepareUploads([join(dir, 'missing.txt')]), isInvalid);
});

test('TC-2.5 a HULY_UPLOAD_ROOT that does not exist is invalid input', async () => {
    const dir = tempDir();
    process.env.HULY_UPLOAD_ROOT = join(dir, 'nope');
    await assert.rejects(prepareUploads([file(dir, 'a.txt')]), isInvalid);
});

test('TC-2.6 one bad path rejects the whole call and nothing is sent', async () => {
    const root = tempDir();
    process.env.HULY_UPLOAD_ROOT = root;
    const good = file(root, 'good.txt');
    const bad = file(tempDir(), 'bad.txt');
    const fake = fakeSource();
    await assert.rejects(
        (async () => attachPrepared(fake.source, 'DELTA-42', await prepareUploads([good, bad])))(),
        isInvalid,
    );
    assert.equal(fake.calls.uploadBlob.length, 0);
    assert.equal(fake.calls.getTask.length, 0);
});

test('TC-2.7 an empty or blank list is invalid input', async () => {
    await assert.rejects(prepareUploads([]), isInvalid);
    await assert.rejects(prepareUploads(['  ']), isInvalid);
});

test('TC-2.8 a FIFO is rejected at once instead of blocking on read', async () => {
    const dir = tempDir();
    const fifo = join(dir, 'pipe');
    execFileSync('mkfifo', [fifo]);
    const started = Date.now();
    await assert.rejects(prepareUploads([fifo]), isInvalid);
    assert.ok(Date.now() - started < 2000);
});

test('TC-2.9 a symlink whose target is a hidden file in the root is rejected', async () => {
    const dir = tempDir();
    const hidden = file(dir, '.env', 'SECRET=1');
    const link = join(dir, 'notes.txt');
    symlinkSync(hidden, link);
    await assert.rejects(prepareUploads([link]), isInvalid);
});

test('TC-2.10 a relative path that climbs out of the root is rejected', async () => {
    const parent = tempDir();
    const root = join(parent, 'root');
    mkdirSync(join(root, 'sub'), { recursive: true });
    file(parent, 'x.txt');
    process.env.HULY_UPLOAD_ROOT = root;
    const climbing = `${relative(process.cwd(), root)}/sub/../../x.txt`;
    await assert.rejects(prepareUploads([climbing]), isInvalid);
});

test('TC-2.11 a relative path is resolved against the working directory', async () => {
    const dir = tempDir();
    const path = file(dir, 'rel.txt', 'rel');
    const [prepared] = await prepareUploads([relative(process.cwd(), path)]);
    assert.equal(prepared.name, 'rel.txt');
    assert.equal(prepared.data.toString(), 'rel');
});

test('TC-2.12 rejecting an outward symlink names the given path, not its real target', async () => {
    const root = tempDir();
    const outsideDir = tempDir();
    const outside = file(outsideDir, 'private-target.txt');
    process.env.HULY_UPLOAD_ROOT = root;
    const link = join(root, 'link.txt');
    symlinkSync(outside, link);
    await assert.rejects(prepareUploads([link]), (e: any) => {
        assert.ok(isInvalid(e));
        assert.ok(e.message.includes('link.txt'), e.message);
        assert.ok(!e.message.includes('private-target'), e.message);
        assert.ok(!e.message.includes(outsideDir), e.message);
        return true;
    });
});

test('TC-2.13 an unknown task is not_found and nothing is sent', async () => {
    const dir = tempDir();
    const fake = fakeSource({ task: null });
    await assert.rejects(
        attachPrepared(fake.source, 'DELTA-999', await prepareUploads([file(dir, 'a.txt')])),
        (e: any) => e?.code === 'not_found',
    );
    assert.equal(fake.calls.uploadBlob.length, 0);
});

test('TC-2.14 a file inside HULY_UPLOAD_ROOT is accepted', async () => {
    const root = tempDir();
    process.env.HULY_UPLOAD_ROOT = root;
    const [prepared] = await prepareUploads([file(root, 'inside.txt', 'ok')]);
    assert.equal(prepared.name, 'inside.txt');
});

test('TC-4.5 when every file goes through nothing is reported failed and nothing removed', async () => {
    const dir = tempDir();
    const { result, calls } = await attach([file(dir, 'a.txt'), file(dir, 'b.txt')]);
    assert.equal(result.failed, 0);
    assert.ok(result.files.every((f) => f.uploadError === undefined));
    assert.equal(calls.removeBlob.length, 0);
});

// --- AC-3: size and count caps ---------------------------------------------

test('TC-3.1 a file over the per-file cap is rejected before anything is sent', async () => {
    const dir = tempDir();
    await assert.rejects(prepareUploads([file(dir, 'big.bin', 'x'.repeat(11))], { maxFileBytes: 10 }), isInvalid);
});

test('TC-3.2 files under the per-file cap but over the total cap are rejected', async () => {
    const dir = tempDir();
    const paths = [file(dir, 'a.bin', 'x'.repeat(6)), file(dir, 'b.bin', 'x'.repeat(6))];
    await assert.rejects(prepareUploads(paths, { maxFileBytes: 10, maxTotalBytes: 10 }), isInvalid);
});

test('TC-3.3 more files than the count cap are rejected', async () => {
    const dir = tempDir();
    const paths = [file(dir, 'a.txt'), file(dir, 'b.txt'), file(dir, 'c.txt')];
    await assert.rejects(prepareUploads(paths, { maxFiles: 2 }), isInvalid);
});

test('TC-3.4 a file exactly at the per-file cap is accepted', async () => {
    const dir = tempDir();
    const prepared = await prepareUploads([file(dir, 'edge.bin', 'x'.repeat(10))], { maxFileBytes: 10 });
    assert.equal(prepared[0].size, 10);
});

test('TC-3.5 the default caps are 50 MiB a file, 200 MiB a call and 20 files', () => {
    assert.deepEqual(UPLOAD_LIMITS, { maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxFiles: 20 });
});

test('TC-3.6 a total and a count exactly at their caps are accepted', async () => {
    const dir = tempDir();
    const paths = [file(dir, 'a.bin', 'x'.repeat(5)), file(dir, 'b.bin', 'x'.repeat(5))];
    const prepared = await prepareUploads(paths, { maxFileBytes: 10, maxTotalBytes: 10, maxFiles: 2 });
    assert.equal(prepared.length, 2);
});

// --- AC-4: failures midway --------------------------------------------------

test('TC-4.1 a failed blob upload is reported on its file and the next file is still sent', async () => {
    const dir = tempDir();
    const { result, calls } = await attach([file(dir, 'first.txt'), file(dir, 'second.txt')], {
        uploadErrors: { 'first.txt': new Error('Storage error quota') },
    });
    assert.equal(result.uploaded, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.files[0].uploadError, 'Storage error quota');
    assert.equal(result.files[0].attachmentId, null);
    assert.equal(result.files[0].blobId, null);
    assert.equal(result.files[1].attachmentId, 'att-blob-1');
    assert.equal(calls.removeBlob.length, 0);
});

test('TC-4.2 a failed attachment record removes the blob just sent', async () => {
    const dir = tempDir();
    const { result, calls } = await attach([file(dir, 'a.txt')], {
        addErrors: { 'a.txt': new Error('Forbidden') },
    });
    assert.deepEqual(calls.removeBlob, ['blob-1']);
    assert.equal(result.failed, 1);
    assert.equal(result.files[0].uploadError, 'Forbidden');
    assert.equal(result.files[0].attachmentId, null);
});

test('TC-4.3 when removing the orphan blob also fails, the original error is reported', async () => {
    const dir = tempDir();
    const { result } = await attach([file(dir, 'a.txt')], {
        addErrors: { 'a.txt': new Error('Forbidden') },
        removeError: new Error('Remove failed'),
    });
    assert.equal(result.files[0].uploadError, 'Forbidden');
});

test('TC-4.4 a long multi-line error is cut to one short line', async () => {
    const dir = tempDir();
    const page = `<html>\n<body>\n${'Bad gateway '.repeat(100)}\n</body>\n</html>`;
    const { result } = await attach([file(dir, 'a.txt')], { uploadErrors: { 'a.txt': new Error(page) } });
    const message = result.files[0].uploadError!;
    assert.ok(!message.includes('\n'));
    assert.ok(Array.from(message).length <= 200);
});

// --- AC-5: MCP input schema -------------------------------------------------

test('TC-5.1 the tool schema takes taskId and paths and rejects anything else', () => {
    assert.ok(addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: ['a.txt'] }).success);
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: ['a.txt'], downloadDir: '/tmp' }).success);
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: [] }).success);
});

test('TC-5.4 the tool schema rejects an empty taskId, empty or non-string paths, and more than 20 paths', () => {
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: '', paths: ['a.txt'] }).success);
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: [''] }).success);
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: [42] }).success);
    const many = Array.from({ length: 21 }, (_, i) => `f${i}.txt`);
    assert.ok(!addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: many }).success);
    assert.ok(addAttachmentInputSchema.safeParse({ taskId: 'DELTA-1', paths: many.slice(0, 20) }).success);
});
