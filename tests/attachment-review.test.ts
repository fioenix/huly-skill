import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
    addAttachmentRecord,
    attachExitCode,
    attachPrepared,
    prepareUploads,
    storeBlob,
    toCallError,
} from '../src/utils/attachment-upload.js';
import { hulyError } from '../src/utils/errors.js';

// Fixes for testcases/T-261128-upload-dinh-kem/review-1.md, one AC per R code.

const ROOT = resolve(import.meta.dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const created: string[] = [];
// The temp directory itself is too broad to be a root: every test works in a
// directory below it, which is the default root.
const BASE = realpathSync(mkdtempSync(join(tmpdir(), 'huly-review-base-')));
created.push(BASE);
const startCwd = process.cwd();
after(() => {
    process.chdir(startCwd);
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
    process.env.HULY_UPLOAD_ROOT = BASE;
});
afterEach(() => {
    delete process.env.HULY_UPLOAD_ROOT;
    process.chdir(startCwd);
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(BASE, 'huly-review-')));
    created.push(dir);
    return dir;
}

function file(dir: string, name: string, content: string | Buffer = 'abc'): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
}

const TASK = { _id: 'issue-1', identifier: 'DELTA-42', space: 'project-1' };

function fakeSource(opts: {
    uploadErrors?: Record<string, Error>;
    addErrors?: Record<string, Error>;
    removeError?: Error;
} = {}) {
    const calls = {
        uploadBlob: [] as { key: string; name: string; type: string }[],
        removeBlob: [] as string[],
        addIssueAttachment: [] as any[],
    };
    const source = {
        async getTask() {
            return TASK;
        },
        async uploadBlob({ key, name, type }: { key: string; name: string; data: Buffer; type: string }) {
            calls.uploadBlob.push({ key, name, type });
            if (opts.uploadErrors?.[name]) throw opts.uploadErrors[name];
            return { _id: key };
        },
        async removeBlob(blobId: string) {
            calls.removeBlob.push(blobId);
            if (opts.removeError) throw opts.removeError;
        },
        async addIssueAttachment(_task: any, attrs: any) {
            calls.addIssueAttachment.push(attrs);
            if (opts.addErrors?.[attrs.name]) throw opts.addErrors[attrs.name];
            return `att-${attrs.name}`;
        },
    };
    return { source, calls };
}

async function prepare(names: string[]) {
    const dir = tempDir();
    return prepareUploads(names.map((n) => file(dir, n)));
}

// --- AC-1 (R1): auth and connection end the whole call ---------------------

test('TC-1.1 a connection error on the first file fails the call and stops before the next file', async () => {
    const fake = fakeSource({ uploadErrors: { 'a.txt': hulyError('connection', 'Network error TypeError: fetch failed') } });
    await assert.rejects(attachPrepared(fake.source, 'DELTA-42', await prepare(['a.txt', 'b.txt'])), (e: any) => {
        assert.equal(e.code, 'connection');
        return true;
    });
    assert.deepEqual(fake.calls.uploadBlob.map((c) => c.name), ['a.txt']);
});

test('TC-1.2 an auth error on the second file fails the call and names what already went up', async () => {
    const fake = fakeSource({ uploadErrors: { 'b.txt': hulyError('auth', '403 Forbidden') } });
    await assert.rejects(attachPrepared(fake.source, 'DELTA-42', await prepare(['a.txt', 'b.txt'])), (e: any) => {
        assert.equal(e.code, 'auth');
        assert.ok(e.message.includes('a.txt'), e.message);
        assert.ok(e.message.includes('att-a.txt'), e.message);
        return true;
    });
});

test('TC-1.3 toCallError marks network and auth failures, and leaves others alone', () => {
    assert.equal((toCallError(new Error('Network error TypeError: fetch failed')) as any).code, 'connection');
    assert.equal((toCallError(new Error('401 Unauthorized')) as any).code, 'auth');
    const other = new Error('Storage error quota');
    const kept = toCallError(other) as any;
    assert.equal(kept.code, undefined);
    assert.equal(kept.message, 'Storage error quota');
});

// --- AC-2 (R2): the data.url sentence stays with huly task -----------------

test('TC-2.1 in commands.md the data.url sentence follows the task detail and precedes huly attach', () => {
    const md = readFileSync(join(ROOT, 'skills/huly-skill/references/commands.md'), 'utf8');
    const filesLine = md.indexOf('Files attached to comments are not included.');
    const urlLine = md.indexOf('`data.url` is the issue\'s web link');
    const attachPara = md.indexOf('`huly attach <id> <file...>` (MCP:');
    assert.ok(filesLine >= 0 && urlLine >= 0 && attachPara >= 0);
    assert.equal(md.slice(filesLine + 'Files attached to comments are not included.'.length, urlLine).trim(), '');
    assert.ok(attachPara > urlLine);
});

test('TC-2.2 the huly attach paragraph appears exactly once in commands.md', () => {
    const md = readFileSync(join(ROOT, 'skills/huly-skill/references/commands.md'), 'utf8');
    assert.equal(md.split('`huly attach <id> <file...>` (MCP:').length - 1, 1);
});

// --- AC-3 (R3): blobs are only removed when that is known to be safe --------

test('TC-3.1 a connection error while recording keeps the blob and names it', async () => {
    const fake = fakeSource({ addErrors: { 'a.txt': hulyError('connection', 'connection closed') } });
    await assert.rejects(attachPrepared(fake.source, 'DELTA-42', await prepare(['a.txt'])), (e: any) => {
        assert.equal(e.code, 'connection');
        assert.ok(e.message.includes(fake.calls.uploadBlob[0].key), e.message);
        return true;
    });
    assert.equal(fake.calls.removeBlob.length, 0);
});

test('TC-3.2 a blob that cannot be removed stays reported with cleanupError', async () => {
    const fake = fakeSource({ addErrors: { 'a.txt': new Error('Rejected') }, removeError: new Error('Remove failed') });
    const result = await attachPrepared(fake.source, 'DELTA-42', await prepare(['a.txt']));
    const entry = result.files[0];
    assert.equal(entry.uploadError, 'Rejected');
    assert.equal(entry.blobId, fake.calls.uploadBlob[0].key);
    assert.equal(entry.cleanupError, 'Remove failed');
});

test('TC-3.3 a blob that is removed leaves no blobId and no cleanupError', async () => {
    const fake = fakeSource({ addErrors: { 'a.txt': new Error('Rejected') } });
    const result = await attachPrepared(fake.source, 'DELTA-42', await prepare(['a.txt']));
    assert.equal(result.files[0].blobId, null);
    assert.equal(result.files[0].cleanupError, undefined);
    assert.equal(fake.calls.removeBlob.length, 1);
});

// --- AC-4 (R4): a stalled upload times out ----------------------------------

test('TC-4.1 a put that never finishes times out as a connection error', async () => {
    const storage = { put: () => new Promise(() => {}), remove: async () => {} };
    const started = Date.now();
    await assert.rejects(storeBlob(storage, 'k', Buffer.from('x'), 'text/plain', 50), (e: any) => e.code === 'connection');
    assert.ok(Date.now() - started < 1000);
});

test('TC-4.2 a put that answers returns its id', async () => {
    const storage = { put: async () => ({ _id: '0b0f6d1e-1111-4222-8333-944455556666' }), remove: async () => {} };
    assert.deepEqual(await storeBlob(storage, 'k', Buffer.from('x'), 'text/plain', 1000), { _id: '0b0f6d1e-1111-4222-8333-944455556666' });
});

// --- AC-5 (R5): the call total is checked from the size, before reading ------

test('TC-5.1 files over the call total are refused with the total limit', async () => {
    const dir = tempDir();
    const paths = [file(dir, 'a.bin', 'x'.repeat(6)), file(dir, 'b.bin', 'x'.repeat(6))];
    await assert.rejects(prepareUploads(paths, { maxFileBytes: 10, maxTotalBytes: 10 }), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /for one call/);
        return true;
    });
});

test('TC-5.2 a second file that exactly fills what is left of the total is accepted', async () => {
    const dir = tempDir();
    const paths = [file(dir, 'a.bin', 'x'.repeat(4)), file(dir, 'b.bin', 'x'.repeat(6))];
    const prepared = await prepareUploads(paths, { maxFileBytes: 10, maxTotalBytes: 10 });
    assert.deepEqual(prepared.map((p) => p.size), [4, 6]);
});

// --- AC-6 (R6): the storage and record calls themselves ---------------------

test('TC-6.1 storeBlob sends the key it is given, the type and the byte count', async () => {
    const calls: any[] = [];
    const storage = {
        put: async (...args: any[]) => {
            calls.push(args);
            return { _id: args[0] };
        },
        remove: async () => {},
    };
    const key = '0b0f6d1e-1111-4222-8333-944455556666';
    await storeBlob(storage, key, Buffer.from('abcd'), 'text/plain', 1000);
    assert.equal(calls[0][0], key);
    assert.equal(calls[0][2], 'text/plain');
    assert.equal(calls[0][3], 4);
});

test('TC-6.2 addAttachmentRecord adds to the issue attachments collection', async () => {
    const calls: any[] = [];
    const client = {
        addCollection: async (...args: any[]) => {
            calls.push(args);
            return 'att-1';
        },
    };
    const attrs = { name: 'a.txt', file: 'k', type: 'text/plain', size: 3, lastModified: 1 };
    const id = await addAttachmentRecord(client, TASK, attrs, { attachment: 'attachment:class:Attachment', issue: 'tracker:class:Issue' });
    assert.equal(id, 'att-1');
    assert.deepEqual(calls[0], ['attachment:class:Attachment', 'project-1', 'issue-1', 'tracker:class:Issue', 'attachments', attrs]);
});

test('TC-6.3 an unsafe id from storage removes the key just sent and fails', async () => {
    const removed: string[] = [];
    const storage = { put: async () => ({ _id: '../etc' }), remove: async (k: string) => { removed.push(k); } };
    await assert.rejects(storeBlob(storage, 'the-key', Buffer.from('x'), 'text/plain', 1000));
    assert.deepEqual(removed, ['the-key']);
});

test('TC-6.4 a NetworkError from put becomes a connection error', async () => {
    const network = Object.assign(new Error('Network error TypeError: fetch failed'), { name: 'NetworkError' });
    const storage = { put: async () => { throw network; }, remove: async () => {} };
    await assert.rejects(storeBlob(storage, 'k', Buffer.from('x'), 'text/plain', 1000), (e: any) => e.code === 'connection');
});

// --- AC-7 (R7): the storage key is separate from the name -------------------

test('TC-7.1 each file goes up under a fresh UUID key, recorded as its file, with the name kept apart', async () => {
    const fake = fakeSource();
    await attachPrepared(fake.source, 'DELTA-42', await prepare(['report.pdf']));
    const sent = fake.calls.uploadBlob[0];
    assert.match(sent.key, UUID);
    assert.equal(sent.name, 'report.pdf');
    assert.equal(fake.calls.addIssueAttachment[0].file, sent.key);
    assert.equal(fake.calls.addIssueAttachment[0].name, 'report.pdf');
});

test('TC-7.2 two files of the same name go up under two different keys', async () => {
    const fake = fakeSource();
    const one = file(tempDir(), 'same.txt', 'one');
    const two = file(tempDir(), 'same.txt', 'two');
    await attachPrepared(fake.source, 'DELTA-42', await prepareUploads([one, two]));
    const [a, b] = fake.calls.uploadBlob.map((c) => c.key);
    assert.match(a, UUID);
    assert.match(b, UUID);
    assert.notEqual(a, b);
});

// --- AC-8 (R8): exit status of the CLI --------------------------------------

test('TC-8.1 the CLI exits 1 when any file failed and 0 otherwise', () => {
    assert.equal(attachExitCode({ failed: 0 }), 0);
    assert.equal(attachExitCode({ failed: 2 }), 1);
});

// --- AC-10 (R10): reading across chunks -------------------------------------

const MiB = 1024 * 1024;

test('TC-10.1 a 3 MiB file over a 2 MiB cap is refused', async () => {
    const dir = tempDir();
    await assert.rejects(prepareUploads([file(dir, 'big.bin', Buffer.alloc(3 * MiB, 1))], { maxFileBytes: 2 * MiB }), (e: any) => e.code === 'invalid_input');
});

test('TC-10.2 a file exactly at a 2 MiB cap is read in full', async () => {
    const dir = tempDir();
    const content = Buffer.alloc(2 * MiB);
    for (let i = 0; i < content.length; i++) content[i] = i % 251;
    const [prepared] = await prepareUploads([file(dir, 'edge.bin', content)], { maxFileBytes: 2 * MiB });
    assert.ok(prepared.data.equals(content));
});

// --- AC-11 (R11): docs say where files may come from -------------------------

test('TC-11.1 SKILL.md, setup.md and README tell where huly attach may read', () => {
    const skill = readFileSync(join(ROOT, 'skills/huly-skill/SKILL.md'), 'utf8');
    assert.match(skill, /HULY_UPLOAD_ROOT/);
    for (const doc of ['skills/huly-skill/references/setup.md', 'README.md']) {
        const line = readFileSync(join(ROOT, doc), 'utf8').split('\n').find((l) => l.includes('HULY_UPLOAD_ROOT'));
        assert.ok(line, `${doc} mentions HULY_UPLOAD_ROOT`);
        assert.match(line!, /huly_add_attachment/, doc);
    }
});

test('TC-11.2 docs no longer give the temp directory as a default upload root', () => {
    const commands = readFileSync(join(ROOT, 'skills/huly-skill/references/commands.md'), 'utf8');
    const start = commands.indexOf('`huly attach <id> <file...>` (MCP:');
    const paragraph = commands.slice(start, commands.indexOf('\n\n', start));
    assert.doesNotMatch(paragraph, /temp/);

    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    // The bullet is its first line plus the indented lines that continue it.
    const lines = agents.split('\n');
    const first = lines.findIndex((l) => l.startsWith('- `HULY_UPLOAD_ROOT`'));
    assert.ok(first >= 0);
    const bullet = [lines[first]];
    for (let i = first + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) bullet.push(lines[i]);
    assert.ok(bullet.length > 1, 'bullet continues on an indented line');
    assert.doesNotMatch(bullet.join('\n'), /temp/);
    const row = lines.find((l) => l.startsWith('| `huly attach'));
    assert.ok(row);
    assert.doesNotMatch(row!, /temp/);
});

// --- AC-9 (R9): a blank root setting reads as unset -------------------------

test('TC-9.2 a blank HULY_UPLOAD_ROOT reads as unset, so the working directory is the root', async () => {
    process.env.HULY_UPLOAD_ROOT = '   ';
    const cwd = tempDir();
    const path = file(cwd, 'blank.txt', 'blank');
    process.chdir(cwd);
    const [prepared] = await prepareUploads([path]);
    assert.equal(prepared.data.toString(), 'blank');
});

// --- AC-12 (R12): default root is the working directory only ----------------

test('TC-12.1 without HULY_UPLOAD_ROOT a file in the temp directory is refused', async () => {
    delete process.env.HULY_UPLOAD_ROOT;
    const cwd = tempDir();
    const elsewhere = file(tempDir(), 'x.txt');
    process.chdir(cwd);
    await assert.rejects(prepareUploads([elsewhere]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /HULY_UPLOAD_ROOT/);
        return true;
    });
});

test('TC-12.2 without HULY_UPLOAD_ROOT a file in the working directory is accepted', async () => {
    delete process.env.HULY_UPLOAD_ROOT;
    const cwd = tempDir();
    const path = file(cwd, 'here.txt', 'here');
    process.chdir(cwd);
    const [prepared] = await prepareUploads([path]);
    assert.equal(prepared.data.toString(), 'here');
});

test('TC-12.3 without HULY_UPLOAD_ROOT a working directory of home is refused', async () => {
    delete process.env.HULY_UPLOAD_ROOT;
    process.chdir(homedir());
    await assert.rejects(prepareUploads([join(homedir(), 'any-file.txt')]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /HULY_UPLOAD_ROOT/);
        return true;
    });
});
