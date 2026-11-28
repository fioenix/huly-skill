import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { attachPrepared, formatAttachText, prepareUploads, readCapped, removeStoredBlob, samePath } from '../src/utils/attachment-upload.js';
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

// Code review 2: the timed-out `put` keeps running, so its blob may still land.
test('a dropped connection or timeout while storing the first file is not retryable and names the key', async () => {
    for (const message of ['fetch failed', 'Upload timed out after 120s']) {
        const src = source({ uploadErrors: { 'a.txt': hulyError('connection', message) } });
        await assert.rejects(attachPrepared(src, 'DELTA-42', await prepareUploads(filesIn(['a.txt']))), (e: any) => {
            const payload = errorPayload(e);
            assert.equal(payload.code, 'connection');
            assert.equal(payload.retryable, false);
            assert.ok(payload.error.includes(src.keys[0]), payload.error);
            return true;
        });
    }
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

// --- Review round 2, N4: a hidden root, other shared temps, temp's ancestors --

function hiddenProject(): { root: string; path: string } {
    const [seed] = filesIn(['seed.txt']);
    const root = join(dirname(seed), '.config', 'proj');
    mkdirSync(root, { recursive: true });
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'transcript');
    return { root, path };
}

test('HULY_UPLOAD_ROOT inside a hidden directory is refused, naming why', async () => {
    const { root, path } = hiddenProject();
    process.env.HULY_UPLOAD_ROOT = root;
    await assert.rejects(prepareUploads([path]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /HULY_UPLOAD_ROOT .* is inside a hidden directory/);
        return true;
    });
});

test('without HULY_UPLOAD_ROOT a working directory inside a hidden directory is refused', async () => {
    const { root } = hiddenProject();
    delete process.env.HULY_UPLOAD_ROOT;
    process.chdir(root);
    await assert.rejects(prepareUploads(['history.jsonl']), (e: any) => /working directory .* is inside a hidden directory/.test(e.message));
});

test('HULY_UPLOAD_ROOT=/var/tmp is refused as too broad', { skip: !existsSync('/var/tmp') }, async () => {
    await refusedAsRoot('/var/tmp');
});

test('HULY_UPLOAD_ROOT=/dev/shm is refused as too broad', { skip: !existsSync('/dev/shm') }, async () => {
    await refusedAsRoot('/dev/shm');
});

test('HULY_UPLOAD_ROOT set to the grandparent of a macOS temp directory is refused', {
    skip: !realpathSync(tmpdir()).startsWith('/private/var/folders/'),
}, async () => {
    await refusedAsRoot(dirname(dirname(realpathSync(tmpdir()))));
    await refusedAsRoot('/private/var/folders');
    await refusedAsRoot('/private/var');
});

// --- Review round 2, N2: a project holding a custom TMPDIR is not too broad --

test('a project directory that holds a custom TMPDIR is accepted as a root', async () => {
    const [path] = filesIn(['report.txt']);
    const project = dirname(path);
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = join(project, 'tmp');
    mkdirSync(process.env.TMPDIR);
    try {
        const files = await prepareUploads([path]);
        assert.deepEqual(files.map((f) => f.name), ['report.txt']);
    } finally {
        if (savedTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = savedTmp;
    }
});

// --- Security review 2: files named like keys or credentials are refused ----

async function refusedAsSecret(name: string) {
    const [path] = filesIn([name]);
    await assert.rejects(prepareUploads([path]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.ok(e.message.includes(path), e.message);
        assert.match(e.message, /looks like a key, certificate or credential/);
        return true;
    });
}

for (const name of ['key.pem', 'server.KEY', 'cert.p12', 'bundle.pfx']) {
    test(`a private key or certificate file (${name}) is refused`, () => refusedAsSecret(name));
}

for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa_work']) {
    test(`an SSH private key (${name}) is refused`, () => refusedAsSecret(name));
}

for (const name of ['terraform.tfstate', 'terraform.tfstate.backup']) {
    test(`Terraform state (${name}) is refused`, () => refusedAsSecret(name));
}

for (const name of ['credentials.json', 'AWS_Credential.txt', 'secrets.yaml', 'client_secret.json', 'service-account.json', 'my_service_account.json']) {
    test(`a name containing credential, secret or service-account (${name}) is refused`, () => refusedAsSecret(name));
}

// --- Review round 2, N5 and N6: more secrets refused, fewer ordinary files ---

function fileIn(rel: string, content: string | Buffer): string {
    const [seed] = filesIn(['seed.txt']);
    const path = join(dirname(seed), rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
}

const ZIP = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(32)]);
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAsynthetic\n-----END OPENSSH PRIVATE KEY-----\n';

for (const name of [
    'key.pem.bak', 'server.key.orig', 'cert.p12.old', 'deploy.pem~',
    'terraform.tfvars', 'prod.tfvars.json', 'prod.env', 'env.production',
    'AuthKey_ABC123.p8', 'putty.ppk', 'release.jks', 'app.keystore', 'vault.kdbx', 'kubeconfig',
    'my_secret_key.txt', 'Secret.txt', 'credential.txt',
]) {
    test(`a likely secret (${name}) is refused`, () => refusedAsSecret(name));
}

test('a file inside a secrets or credentials directory is refused', async () => {
    for (const rel of [join('secrets', 'db.yaml'), join('config', 'credentials', 'prod.yaml')]) {
        const path = fileIn(rel, 'x');
        await assert.rejects(prepareUploads([path]), (e: any) => /looks like a key, certificate or credential/.test(e.message));
    }
});

test('a file whose content is a private key is refused whatever its name', async () => {
    for (const content of [PRIVATE_KEY, `\n  ${PRIVATE_KEY}`, '-----BEGIN RSA PRIVATE KEY-----\nx\n', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nx\n']) {
        const path = fileIn('notes.txt', content);
        await assert.rejects(prepareUploads([path]), (e: any) => {
            assert.equal(e.code, 'invalid_input');
            assert.match(e.message, /holds a private key/);
            assert.ok(!e.message.includes('synthetic'));
            return true;
        });
    }
});

test('a .key file with a zip header (Apple Keynote) passes; one without it is refused', async () => {
    const deck = fileIn('deck.key', ZIP);
    assert.deepEqual((await prepareUploads([deck])).map((f) => f.name), ['deck.key']);
    const server = fileIn('server.key', 'not a zip');
    await assert.rejects(prepareUploads([server]), (e: any) => /looks like a key, certificate or credential/.test(e.message));
});

test('a .pem file is refused even with a zip header when it is a backup of another rule', async () => {
    // A zip header lets only *.key and *.pem (and their backups) through.
    const pem = fileIn('bundle.pem.bak', ZIP);
    assert.deepEqual((await prepareUploads([pem])).map((f) => f.name), ['bundle.pem.bak']);
    const p12 = fileIn('cert.p12', ZIP);
    await assert.rejects(prepareUploads([p12]), (e: any) => /looks like a key/.test(e.message));
});

test('the refusal says how to send a file that is not a secret', async () => {
    const path = fileIn('server.key', 'x');
    await assert.rejects(prepareUploads([path]), (e: any) => /rename it or zip it/.test(e.message));
});

test('ordinary names that merely contain secret, credential or service-account pass', async () => {
    const names = ['secretary-notes.md', 'credentialing-process.docx', 'service-account-setup-guide.md', 'env.d.ts', 'environment.md'];
    const files = await prepareUploads(filesIn(names));
    assert.deepEqual(files.map((f) => f.name), names);
});

test('a symlink with an ordinary name pointing at a key file is refused', async () => {
    const [key] = filesIn(['deploy.pem']);
    const link = join(dirname(key), 'notes.txt');
    symlinkSync(key, link);
    await assert.rejects(prepareUploads([link]), (e: any) => /looks like a key/.test(e.message));
});

// --- Security review S3: a hard link can get around the name and root rules --

test('a file with more than one hard link is refused', async () => {
    const [key] = filesIn(['deploy-notes.txt']);
    const link = join(dirname(key), 'notes.txt');
    linkSync(key, link);
    await assert.rejects(prepareUploads([link]), (e: any) => {
        assert.equal(e.code, 'invalid_input');
        assert.match(e.message, /more than one hard link/);
        return true;
    });
});

test('a directory swapped for a symlink after the check no longer matches the opened file', async () => {
    const [seed] = filesIn(['seed.txt']);
    const dir = dirname(seed);
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    const real = join(dir, 'a', 'f.txt');
    writeFileSync(real, 'checked');
    writeFileSync(join(dir, 'b', 'f.txt'), 'swapped');
    const opened = statSync(real);
    assert.equal(await samePath(real, opened), true);
    renameSync(join(dir, 'a'), join(dir, 'a-old'));
    symlinkSync(join(dir, 'b'), join(dir, 'a'));
    assert.equal(await samePath(real, opened), false);
});

// --- Code review 4: text output shows a blob that could not be removed -----

test('the text output names a stored file that could not be removed', async () => {
    const text = formatAttachText('DELTA-42', {
        uploaded: 1,
        failed: 1,
        files: [
            { path: '/w/a.txt', name: 'a.txt', type: 'text/plain', size: 3, attachmentId: 'att-1', blobId: 'blob-1' },
            {
                path: '/w/b.txt', name: 'b.txt', type: 'text/plain', size: 3, attachmentId: null, blobId: 'blob-2',
                uploadError: 'record refused', cleanupError: 'remove failed',
            },
        ],
    });
    assert.match(text, /Attached 1 of 2 file\(s\) to DELTA-42/);
    assert.match(text, /b\.txt .*upload failed: record refused/);
    assert.match(text, /stored file blob-2 could not be removed: remove failed/);
    assert.doesNotMatch(text.split('\n').find((l) => l.includes('a.txt'))!, /could not be removed/);
});

test('ordinary files, including a public SSH key, still pass', async () => {
    const files = await prepareUploads(filesIn(['report.pdf', 'keynote.txt', 'id_rsa.pub', 'minutes-notes.md']));
    assert.deepEqual(files.map((f) => f.name), ['report.pdf', 'keynote.txt', 'id_rsa.pub', 'minutes-notes.md']);
});
