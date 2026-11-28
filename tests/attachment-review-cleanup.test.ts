import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attachPrepared, prepareUploads } from '../src/utils/attachment-upload.js';
import { hulyError } from '../src/utils/errors.js';

// Found by the independent check of the review-1 fixes: when a call-ending
// error comes with a blob that could not be removed, the error is all the
// caller gets, so it has to name that blob.

const created: string[] = [];
after(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
    delete process.env.HULY_UPLOAD_ROOT;
});

test('a call-ending error names a blob that could not be removed', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-cleanup-')));
    created.push(dir);
    process.env.HULY_UPLOAD_ROOT = dir;
    const path = join(dir, 'a.txt');
    writeFileSync(path, 'abc');

    let key = '';
    const source = {
        async getTask() { return { _id: 'issue-1', space: 'project-1' }; },
        async uploadBlob(file: { key: string }) { key = file.key; return { _id: file.key }; },
        async removeBlob() { throw new Error('Remove failed'); },
        async addIssueAttachment() { throw hulyError('auth', '403 Forbidden'); },
    };
    await assert.rejects(attachPrepared(source, 'DELTA-42', await prepareUploads([path])), (e: any) => {
        assert.equal(e.code, 'auth');
        assert.ok(e.message.includes(key), e.message);
        assert.match(e.message, /could not be removed: Remove failed/);
        return true;
    });
});
