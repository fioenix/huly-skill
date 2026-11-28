import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { attachPrepared, prepareUploads, recordAttachment, storeBlob, uploadFile } from '../src/utils/attachment-upload.js';
import { errorPayload, hulyError } from '../src/utils/errors.js';
import { attachment, tracker } from '../src/huly-types.js';

// Fixes for testcases/T-261128-upload-dinh-kem/review-2.md (R3, R6, R20, R21, R22).

const ROOT = resolve(import.meta.dirname, '..');
const created: string[] = [];
after(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
    delete process.env.HULY_UPLOAD_ROOT;
});

function filesIn(names: string[]): { dir: string; paths: string[] } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-review2-')));
    created.push(dir);
    process.env.HULY_UPLOAD_ROOT = dir;
    return {
        dir,
        paths: names.map((name) => {
            const path = join(dir, name);
            writeFileSync(path, name);
            return path;
        }),
    };
}

function source(opts: { addErrors?: Record<string, Error>; removeError?: Error } = {}) {
    const keys: Record<string, string> = {};
    return {
        keys,
        async getTask() { return { _id: 'issue-1', space: 'project-1' }; },
        async uploadBlob(file: { key: string; name: string }) {
            keys[file.name] = file.key;
            return { _id: file.key };
        },
        async removeBlob() {
            if (opts.removeError) throw opts.removeError;
        },
        async addIssueAttachment(_task: any, attrs: any) {
            if (opts.addErrors?.[attrs.name]) throw opts.addErrors[attrs.name];
            return `att-${attrs.name}`;
        },
    };
}

// --- AC-1 (R3): a blob left behind is always named ---------------------------

test('TC-1.1 a blob an earlier file could not remove is named when a later file ends the call', async () => {
    const src = source({
        addErrors: { 'a.txt': new Error('Rejected'), 'b.txt': hulyError('auth', '403 Forbidden') },
        removeError: new Error('Remove failed'),
    });
    await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt', 'b.txt']).paths)), (e: any) => {
        assert.equal(e.code, 'auth');
        assert.ok(e.message.includes(src.keys['a.txt']), e.message);
        return true;
    });
});

test('TC-1.2 an unsafe id whose key cannot be removed names the key and the removal error', async () => {
    const storage = { put: async () => ({ _id: '../etc' }), remove: async () => { throw new Error('Remove failed'); } };
    await assert.rejects(storeBlob(storage, 'the-key', Buffer.from('x'), 'text/plain', 1000), (e: any) => {
        assert.ok(e.message.includes('the-key'), e.message);
        assert.match(e.message, /Remove failed/);
        return true;
    });
});

test('TC-1.3 an unsafe id whose key is removed says nothing about a failed removal', async () => {
    const storage = { put: async () => ({ _id: '../etc' }), remove: async () => {} };
    await assert.rejects(storeBlob(storage, 'the-key', Buffer.from('x'), 'text/plain', 1000), (e: any) => {
        assert.doesNotMatch(e.message, /could not be removed/);
        return true;
    });
});

// --- AC-2 (R6): the client wiring -------------------------------------------

test('TC-2.1 uploadFile stores under the file key, not its name', async () => {
    const sent: string[] = [];
    const storage = { put: async (name: string) => { sent.push(name); return { _id: name }; }, remove: async () => {} };
    const key = '0b0f6d1e-1111-4222-8333-944455556666';
    await uploadFile(storage, { key, name: 'report.pdf', data: Buffer.from('x'), type: 'application/pdf' });
    assert.deepEqual(sent, [key]);
});

test('TC-2.2 recordAttachment adds an Attachment to the attachments collection of an Issue', async () => {
    const calls: any[] = [];
    const client = { addCollection: async (...args: any[]) => { calls.push(args); return 'att-1'; } };
    const attrs = { name: 'a.txt', file: 'k', type: 'text/plain', size: 1, lastModified: 1 };
    assert.equal(await recordAttachment(client, { _id: 'issue-1', space: 'project-1' }, attrs), 'att-1');
    assert.deepEqual(calls[0], [attachment.class.Attachment, 'project-1', 'issue-1', tracker.class.Issue, 'attachments', attrs]);
    assert.equal(calls[0][0], 'attachment:class:Attachment');
    assert.equal(calls[0][3], 'tracker:class:Issue');
});

test('TC-2.3 a dropped connection while recording becomes a connection error', async () => {
    // The shape Huly's client throws once its socket is closed (PlatformError).
    const closed = Object.assign(new Error('ERROR: platform:status:ConnectionClosed {}'), { status: { code: 'platform:status:ConnectionClosed' } });
    const client = { addCollection: async () => { throw closed; } };
    await assert.rejects(recordAttachment(client, { _id: 'i', space: 's' }, {}), (e: any) => e.code === 'connection');
});

// --- AC-3 (R20): the connection path through the envelope and the CLI --------

test('TC-3.1 a blob kept after a dropped connection makes the error not retryable, with no retry hint', async () => {
    const src = source({ addErrors: { 'a.txt': hulyError('connection', 'connection closed') } });
    await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt']).paths)), (e: any) => {
        const payload = errorPayload(e);
        assert.equal(payload.code, 'connection');
        assert.equal(payload.retryable, false);
        assert.equal(payload.hint, undefined);
        return true;
    });
});

test('TC-3.2 the CLI reports an unreachable host as connection with exit 5', () => {
    const { dir, paths } = filesIn(['a.txt']);
    const run = spawnSync(process.execPath, [join(ROOT, 'bin/huly.cjs'), '--json', 'attach', 'DELTA-1', paths[0]], {
        env: {
            ...process.env,
            HULY_HOST: 'http://127.0.0.1:9',
            HULY_WORKSPACE_ID: '00000000-0000-0000-0000-000000000000',
            HULY_API_KEY: 'test-token-not-real',
            HULY_UPLOAD_ROOT: dir,
        },
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.equal(run.status, 5, run.stdout + run.stderr);
    const payload = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
    assert.equal(payload.code, 'connection');
});

// --- AC-4 (R21): docs on retryable --------------------------------------------

test('TC-4.1 docs and errors.ts say a kept blob also makes the error not retryable', () => {
    for (const doc of ['skills/huly-skill/references/commands.md', 'AGENTS.md', 'CHANGELOG.md']) {
        const text = readFileSync(join(ROOT, doc), 'utf8');
        const at = text.indexOf('retryable: false');
        assert.ok(at >= 0, doc);
        assert.match(text.slice(Math.max(0, at - 300), at + 300), /kept/, doc);
    }
    const errors = readFileSync(join(ROOT, 'src/utils/errors.ts'), 'utf8');
    const header = errors.slice(0, errors.indexOf('export type ErrorPayload'));
    assert.match(header, /retryable: false|already changed/);
});

test('TC-4.2 AGENTS.md JSON Mode still says only connection is retryable', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    assert.match(agents, /only `connection` is `retryable`/);
});

// --- AC-5 (R22): docs name the tmp directory ----------------------------------

test('TC-5.1 the huly attach lines of AGENTS.md and SKILL.md name the tmp directory', () => {
    const row = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').split('\n').find((l) => l.startsWith('| `huly attach'));
    assert.ok(row);
    assert.match(row!, /tmp/);
    const skill = readFileSync(join(ROOT, 'skills/huly-skill/SKILL.md'), 'utf8');
    const start = skill.indexOf('- `huly attach` reads only');
    assert.ok(start >= 0);
    assert.match(skill.slice(start, skill.indexOf('\n- ', start + 1)), /tmp/);
});

test('TC-5.2 setup.md still names the tmp directory for HULY_UPLOAD_ROOT', () => {
    const line = readFileSync(join(ROOT, 'skills/huly-skill/references/setup.md'), 'utf8').split('\n').find((l) => l.includes('HULY_UPLOAD_ROOT'));
    assert.match(line!, /tmp/);
});
