import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { attachPrepared, prepareUploads, readCapped, removeStoredBlob } from '../src/utils/attachment-upload.js';
import { errorPayload, hulyError } from '../src/utils/errors.js';

// Found by the independent check of the review-1 fixes (fix-check A1.1, A1.2,
// A1.4, A1.5, A1.6).

const created: string[] = [];
const startCwd = process.cwd();
after(() => {
    process.chdir(startCwd);
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
    delete process.env.HULY_UPLOAD_ROOT;
    process.chdir(startCwd);
});

function filesIn(names: string[]): string[] {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-check-')));
    created.push(dir);
    process.env.HULY_UPLOAD_ROOT = dir;
    return names.map((name) => {
        const path = join(dir, name);
        writeFileSync(path, name);
        return path;
    });
}

function source(opts: { uploadErrors?: Record<string, Error> } = {}) {
    const keys: string[] = [];
    return {
        keys,
        async getTask() { return { _id: 'issue-1', space: 'project-1' }; },
        async uploadBlob(file: { key: string; name: string }) {
            keys.push(file.key);
            if (opts.uploadErrors?.[file.name]) throw opts.uploadErrors[file.name];
            return { _id: file.key };
        },
        async removeBlob() {},
        async addIssueAttachment(_task: any, attrs: any) { return `att-${attrs.name}`; },
    };
}

// --- A1.1: a call that already attached something is not retryable as is ----

test('a dropped connection after a file went up is not retryable with the same arguments', async () => {
    const src = source({ uploadErrors: { 'b.txt': hulyError('connection', 'fetch failed') } });
    await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt', 'b.txt']))), (e: any) => {
        const payload = errorPayload(e);
        assert.equal(payload.code, 'connection');
        assert.equal(payload.retryable, false);
        assert.equal(payload.hint, undefined);
        assert.match(payload.error, /a\.txt/);
        return true;
    });
});

test('a dropped connection before anything went up stays retryable', async () => {
    const src = source({ uploadErrors: { 'a.txt': hulyError('connection', 'fetch failed') } });
    await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt']))), (e: any) => {
        assert.equal(errorPayload(e).retryable, true);
        return true;
    });
});

// --- A1.2: a blob that may have landed is named by its key ------------------

test('a dropped connection while storing names the key the blob would be under', async () => {
    const src = source({ uploadErrors: { 'a.txt': hulyError('connection', 'Upload timed out after 120s') } });
    await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt']))), (e: any) => {
        assert.ok(e.message.includes(src.keys[0]), e.message);
        return true;
    });
});

// --- A1.4: the read stops one byte past the cap -----------------------------

function fakeHandle(content: Buffer) {
    let offset = 0;
    return {
        async read(buffer: Buffer, at: number, length: number) {
            const n = Math.min(length, content.length - offset);
            content.copy(buffer, at, offset, offset + n);
            offset += n;
            return { bytesRead: n, buffer };
        },
    };
}

test('readCapped returns cap + 1 bytes of a larger file and all of a file at the cap', async () => {
    assert.equal((await readCapped(fakeHandle(Buffer.from('abcdef')) as any, 3)).toString(), 'abcd');
    assert.equal((await readCapped(fakeHandle(Buffer.from('abc')) as any, 3)).toString(), 'abc');
});

// --- A1.5: removing a blob checks and encodes its id ------------------------

test('removeStoredBlob refuses an unsafe id without a request and encodes a safe one', async () => {
    const removed: string[] = [];
    const storage = { remove: async (k: string) => { removed.push(k); } };
    await assert.rejects(removeStoredBlob(storage, '../etc'), (e: any) => e.code === 'invalid_input');
    assert.deepEqual(removed, []);
    await removeStoredBlob(storage, '0b0f6d1e-1111-4222-8333-944455556666');
    assert.deepEqual(removed, ['0b0f6d1e-1111-4222-8333-944455556666']);
});

// --- A1.6: a working directory above home, or temp itself, is too broad -----

test('without HULY_UPLOAD_ROOT a working directory that contains home is refused', async () => {
    process.chdir(dirname(homedir()));
    await assert.rejects(prepareUploads([join(homedir(), 'x.txt')]), (e: any) => /HULY_UPLOAD_ROOT/.test(e.message));
});

test('without HULY_UPLOAD_ROOT the temp directory itself is refused as a working directory', async () => {
    process.chdir(realpathSync(tmpdir()));
    await assert.rejects(prepareUploads(['x.txt']), (e: any) => /HULY_UPLOAD_ROOT/.test(e.message));
});

// --- Security review 1: a configured HULY_UPLOAD_ROOT that broad is refused too

async function refusedAsRoot(root: string) {
    const [path] = filesIn(['a.txt']);
    process.env.HULY_UPLOAD_ROOT = root;
    await assert.rejects(prepareUploads([path]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /HULY_UPLOAD_ROOT .* is too broad/);
        return true;
    });
}

test('HULY_UPLOAD_ROOT=/ is refused as too broad', async () => {
    await refusedAsRoot('/');
});

test('HULY_UPLOAD_ROOT set to home is refused as too broad', async () => {
    await refusedAsRoot(homedir());
});

test('HULY_UPLOAD_ROOT set to the parent of home is refused as too broad', async () => {
    await refusedAsRoot(dirname(homedir()));
});

test('HULY_UPLOAD_ROOT set to the temp directory is refused as too broad', async () => {
    await refusedAsRoot(tmpdir());
});

// --- Security review 4: /tmp, /private/tmp and the parent of tmpdir() --------

test('without HULY_UPLOAD_ROOT a working directory of /tmp is refused', { skip: !existsSync('/tmp') }, async () => {
    process.chdir('/tmp');
    await assert.rejects(prepareUploads(['x.txt']), (e: any) => /is too broad/.test(e.message));
});

test('HULY_UPLOAD_ROOT=/tmp is refused as too broad', { skip: !existsSync('/tmp') }, async () => {
    await refusedAsRoot('/tmp');
});

test('HULY_UPLOAD_ROOT=/private/tmp is refused as too broad', { skip: !existsSync('/private/tmp') }, async () => {
    await refusedAsRoot('/private/tmp');
});

test('HULY_UPLOAD_ROOT set to the parent of the temp directory is refused as too broad', async () => {
    await refusedAsRoot(dirname(realpathSync(tmpdir())));
});
