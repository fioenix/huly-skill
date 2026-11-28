import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildTaskDetail, memoizeSuccess } from '../src/utils/task-detail.js';
import { issueUrl } from '../src/utils/links.js';

const ROOT = resolve(import.meta.dirname, '..');
const TASK = { _id: 'issue-1', identifier: 'DELTA-42', title: 'T', description: null };
const savedRoot = process.env.HULY_DOWNLOAD_ROOT;
const created: string[] = [];

before(() => { delete process.env.HULY_DOWNLOAD_ROOT; });
after(() => {
    if (savedRoot !== undefined) process.env.HULY_DOWNLOAD_ROOT = savedRoot;
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'huly-pr104-')));
    created.push(dir);
    return dir;
}

function attachment(id: string, name: string, extra: Record<string, any> = {}) {
    return { _id: id, name, file: `blob-${id}`, type: 'text/plain', size: null, lastModified: 1, ...extra };
}

function source(opts: { attachments?: any[]; blob?: () => Promise<any>; onAttachments?: () => void } = {}) {
    return {
        async fetchMarkup() { return null; },
        async getAttachments() { opts.onAttachments?.(); return opts.attachments ?? []; },
        async downloadBlob() { return opts.blob ? opts.blob() : Buffer.from('data'); },
    };
}

// --- AC-1 (P1): the link never carries what was pasted into HULY_HOST ---------

test('TC-1.1 credentials, path and query in HULY_HOST are dropped from the link', () => {
    assert.equal(
        issueUrl('https://alice:s3cret@huly.corp.local/login/auth?token=eyJabc', 'acme', 'D-1'),
        'https://huly.corp.local/workbench/acme/tracker/D-1',
    );
    assert.equal(issueUrl('https://huly.app/', 'acme', 'D-1'), 'https://huly.app/workbench/acme/tracker/D-1');
});

test('TC-1.2 a host that is not an http(s) URL gives no link', () => {
    for (const host of ['javascript:alert(1)', 'ftp://huly.app', 'file:///etc/passwd', 'not a url', 'huly.app']) {
        assert.equal(issueUrl(host, 'acme', 'D-1'), null, host);
    }
});

// --- AC-2 (P2): the docs say what the code does ------------------------------

function section(text: string, heading: string): string {
    const start = text.indexOf(heading);
    assert.ok(start >= 0, `${heading} exists`);
    const rest = text.slice(start + heading.length);
    const next = rest.search(/\n#{2,3} /);
    return next < 0 ? rest : rest.slice(0, next);
}

test('TC-2.1 README keeps HULY_DOWNLOAD_ROOT out of the shared-token section and says HTTP has no downloadDir', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    assert.doesNotMatch(section(readme, '### Working around a shared token'), /HULY_DOWNLOAD_ROOT/);
    assert.match(readme, /HULY_DOWNLOAD_ROOT/);
    assert.match(section(readme, '### HTTP'), /downloadDir/);
});

test('TC-2.2 AGENTS.md, the create tool and CHANGELOG describe url, the Link line, the tests and the blob-id rule', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    const createRow = agents.split('\n').find((l) => l.startsWith('| `huly create task <title>'));
    assert.match(createRow ?? '', /url/, 'AGENTS.md create row mentions url');
    const tools = readFileSync(join(ROOT, 'src/mcp/tools.ts'), 'utf8');
    const at = tools.indexOf("'huly_create_task'");
    assert.match(tools.slice(at, at + 600), /`url`/, 'huly_create_task description mentions url');
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const start = changelog.indexOf('## Unreleased');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 5));
    assert.match(unreleased, /Link/);
    assert.match(unreleased, /task-detail-hardening/);
    assert.match(unreleased, /must start with a letter or digit/);
});

// --- AC-3 (P3, P4, P5): edge cases in task-detail ------------------------------

test('TC-3.1 a thrown non-Error with newlines and escapes still gives a one-line downloadError', async () => {
    const dir = tempDir();
    const detail = await buildTaskDetail(
        source({ attachments: [attachment('a1', 'a.txt')], blob: () => Promise.reject('line one\nline two\u001b[31m') }),
        TASK, { downloadDir: dir },
    );
    const err = detail.attachmentFiles[0].downloadError ?? '';
    assert.ok(err.length > 0);
    assert.ok(!/[\u0000-\u001f\u007f]/.test(err), JSON.stringify(err));
});

test('TC-3.2 an explicit undefined limit falls back to the default instead of disabling it', async () => {
    const dir = tempDir();
    const detail = await buildTaskDetail(
        source({ attachments: [attachment('a1', 'big.bin')], blob: async () => Buffer.alloc(5000) }),
        TASK, { downloadDir: dir, limits: { maxFileBytes: undefined, maxTotalBytes: 2000 } },
    );
    assert.ok(detail.attachmentFiles[0].downloadError, 'the 2000-byte total cap still applies');
    assert.deepEqual(readdirSync(dir), []);
});

test('TC-3.3 a stale rejection after reset does not drop the newer cached promise', async () => {
    let calls = 0;
    let rejectFirst!: (e: Error) => void;
    let resolveSecond!: (v: string) => void;
    const get = memoizeSuccess(() => {
        calls++;
        if (calls === 1) return new Promise<string>((_, reject) => { rejectFirst = reject; });
        return new Promise<string>((ok) => { resolveSecond = ok; });
    });
    const first = get();
    first.catch(() => {});
    get.reset();
    const second = get();
    rejectFirst(new Error('stale'));
    await new Promise((r) => setImmediate(r));
    assert.equal(get(), second, 'the newer promise is still the cached one');
    resolveSecond('ok');
    assert.equal(await second, 'ok');
    assert.equal(calls, 2);
});

// --- AC-4 (P6): no directory is created outside the root after a swap ----------

test('TC-4.1 a parent swapped for a symlink before saving creates nothing outside the root', async () => {
    const root = tempDir();
    const outside = tempDir();
    mkdirSync(join(root, 'sub'));
    process.env.HULY_DOWNLOAD_ROOT = root;
    try {
        await assert.rejects(
            buildTaskDetail(source({
                attachments: [attachment('a1', 'a.txt')],
                // Runs after the directory was checked and before it is created.
                onAttachments: () => {
                    renameSync(join(root, 'sub'), join(root, 'sub-old'));
                    symlinkSync(outside, join(root, 'sub'));
                },
            }), TASK, { downloadDir: join(root, 'sub', 'nested') }),
            (e: any) => e?.code === 'invalid_input',
        );
        assert.ok(!existsSync(join(outside, 'nested')), 'nothing created outside the root');
    } finally {
        delete process.env.HULY_DOWNLOAD_ROOT;
    }
});

// --- AC-5 (P7): reserved Windows names after truncation --------------------------

test('TC-5.1 a name that only becomes a reserved device name after cutting is still made safe', async () => {
    const dir = tempDir();
    const detail = await buildTaskDetail(
        source({ attachments: [attachment('a1', 'CON' + ' '.repeat(260) + '.txt'), attachment('a2', 'nul .txt')] }),
        TASK, { downloadDir: dir },
    );
    for (const f of detail.attachmentFiles) {
        const name = (f.localPath ?? '').split(/[\\/]/).pop() ?? '';
        assert.ok(name, 'saved');
        assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\.|$)/i.test(name), `${JSON.stringify(name)} is not a reserved name`);
    }
});
