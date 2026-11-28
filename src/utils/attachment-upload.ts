import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { classifyError, hulyError } from './errors.js';
import { attachment, tracker } from '../huly-types.js';
import { allowedRoots, describeError, formatSize, isSafeBlobId } from './task-detail.js';

/**
 * Upload local files as attachments of an issue. Shared by `huly attach` and
 * the `huly_add_attachment` MCP tool. Every path is checked and every file read
 * before anything is sent, so a bad argument never leaves half the files on
 * the server; the client is passed in so this module loads outside the bundle.
 */

export interface UploadLimits {
    maxFileBytes: number;
    maxTotalBytes: number;
    maxFiles: number;
}

const MiB = 1024 * 1024;
// `put` in the SDK buffers the whole file in memory before sending it.
export const UPLOAD_LIMITS: UploadLimits = { maxFileBytes: 50 * MiB, maxTotalBytes: 200 * MiB, maxFiles: 20 };

// The SDK's `put` has no timeout of its own; matches the download side.
export const UPLOAD_TIMEOUT_MS = 120_000;

type CallErrorCode = 'auth' | 'connection';

/**
 * Mark an error that no later file in the same call could escape: a refused
 * credential or a dropped connection. The SDK throws plain errors, so the
 * client passes what it catches through here; anything else is returned as is
 * and stays a failure of that one file.
 */
export function toCallError(e: unknown): unknown {
    const code = classifyError(e);
    if (code !== 'auth' && code !== 'connection') return e;
    if ((e as { code?: unknown })?.code === code) return e;
    return Object.assign(hulyError(code, describeError(e)), { cause: e });
}

/** Only an explicit code ends the call; a message that merely mentions "forbidden" does not. */
function callErrorCode(e: unknown): CallErrorCode | null {
    const code = (e as { code?: unknown })?.code;
    return code === 'auth' || code === 'connection' ? code : null;
}

export interface BlobStorage {
    put(objectName: string, data: Buffer, contentType: string, size?: number): Promise<{ _id?: unknown } | undefined>;
    remove(objectName: string): Promise<void>;
}

/** Store one blob under `key`, which the caller generates so it can clean up after any failure. */
export async function storeBlob(
    storage: BlobStorage,
    key: string,
    data: Buffer,
    type: string,
    timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<{ _id: string }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(hulyError('connection', `Upload timed out after ${Math.round(timeoutMs / 1000)}s`)),
            timeoutMs,
        );
    });
    let blob: { _id?: unknown } | undefined;
    try {
        blob = await Promise.race([storage.put(key, data, type, data.byteLength), timeout]);
    } catch (e) {
        throw toCallError(e);
    } finally {
        clearTimeout(timer);
    }
    const id = typeof blob?._id === 'string' ? blob._id : '';
    // The id is later spliced into the files URL, like the ones read back.
    if (!isSafeBlobId(id)) {
        let left = '';
        try {
            await storage.remove(key);
        } catch (removeError) {
            left = `; the file sent under ${key} could not be removed: ${describeError(removeError)}`;
        }
        throw hulyError('unknown', `Storage returned an invalid file reference${left}`);
    }
    return { _id: id };
}

/** Remove a stored blob; the id is spliced into the files URL, so an unsafe one is refused unsent. */
export async function removeStoredBlob(storage: Pick<BlobStorage, 'remove'>, blobId: string): Promise<void> {
    if (!isSafeBlobId(blobId)) throw hulyError('invalid_input', 'Invalid attachment file reference');
    try {
        await storage.remove(encodeURIComponent(blobId));
    } catch (e) {
        throw toCallError(e);
    }
}

/** Record a stored blob in the issue's `attachments` collection, which also bumps its count. */
export async function addAttachmentRecord(
    client: { addCollection: (...args: any[]) => Promise<string> },
    issue: { _id: string; space: string },
    attrs: { name: string; file: string; type: string; size: number; lastModified: number },
    classes: { attachment: string; issue: string },
): Promise<string> {
    try {
        return await client.addCollection(classes.attachment, issue.space, issue._id, classes.issue, 'attachments', attrs);
    } catch (e) {
        throw toCallError(e);
    }
}

/**
 * What `HulyClient` does, kept here so it is tested: the client module only
 * loads inside the bundle. The blob goes up under the generated key; the name
 * is for the record alone.
 */
export async function uploadFile(storage: BlobStorage, file: { key: string; name: string; data: Buffer; type: string }): Promise<{ _id: string }> {
    return await storeBlob(storage, file.key, file.data, file.type);
}

export async function recordAttachment(
    client: { addCollection: (...args: any[]) => Promise<string> },
    issue: { _id: string; space: string },
    attrs: { name: string; file: string; type: string; size: number; lastModified: number },
): Promise<string> {
    return await addAttachmentRecord(client, issue, attrs, {
        attachment: attachment.class.Attachment,
        issue: tracker.class.Issue,
    });
}

/** A partial upload still prints every result, but a script must not read it as done. */
export function attachExitCode(result: { failed: number }): number {
    return result.failed > 0 ? 1 : 0;
}

/** The text view of `huly attach`; kept here so it is tested outside the bundle. */
export function formatAttachText(taskId: string, result: { uploaded: number; files: UploadedFile[] }): string {
    let output = `📎 Attached ${result.uploaded} of ${result.files.length} file(s) to ${taskId}:\n`;
    for (const file of result.files) {
        output += `  - ${file.name} (${file.type}, ${formatSize(file.size)})`;
        if (file.uploadError) output += ` ⚠️ upload failed: ${file.uploadError}`;
        if (file.cleanupError) output += ` ⚠️ stored file ${file.blobId} could not be removed: ${file.cleanupError}`;
        output += '\n';
    }
    return output;
}

export interface PreparedFile {
    path: string;
    name: string;
    type: string;
    size: number;
    lastModified: number;
    data: Buffer;
}

export interface UploadedFile {
    path: string;
    name: string;
    type: string;
    size: number;
    attachmentId: string | null;
    blobId: string | null;
    uploadError?: string;
    cleanupError?: string;
}

export interface AttachmentUploadSource {
    getTask(taskId: string): Promise<any | null>;
    uploadBlob(file: { key: string; name: string; data: Buffer; type: string }): Promise<{ _id: string }>;
    removeBlob(blobId: string): Promise<void>;
    addIssueAttachment(task: any, attrs: { name: string; file: string; type: string; size: number; lastModified: number }): Promise<string>;
}

const MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
};

/**
 * Key a blob is stored under. The upload endpoint keeps the key it is sent,
 * so the file name would let two uploads of `report.pdf` overwrite each other
 * across the workspace; the name lives on the attachment record instead.
 */
export function blobObjectName(): string {
    return randomUUID();
}

export function mimeTypeFor(name: string): string {
    return MIME_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export async function prepareUploads(paths: string[], limits: Partial<UploadLimits> = {}): Promise<PreparedFile[]> {
    const caps = { ...UPLOAD_LIMITS, ...limits };
    const given = paths.map((p) => p.trim());
    if (given.length === 0) throw hulyError('invalid_input', 'No file to attach');
    if (given.some((p) => !p)) throw hulyError('invalid_input', 'A file path is empty');
    if (given.length > caps.maxFiles) {
        throw hulyError('invalid_input', `At most ${caps.maxFiles} files can be attached in one call (got ${given.length})`);
    }

    const roots = await uploadRoots();
    const files: PreparedFile[] = [];
    let used = 0;
    for (const input of given) {
        const file = await readAllowed(input, roots, caps, used);
        used += file.size;
        files.push(file);
    }
    return files;
}

/**
 * Where files may be read from. Unlike downloads, the temp directory is not a
 * default: reading sends a file to a workspace many people see, and temp is
 * shared with every other process. A working directory of home or the
 * filesystem root would expose everything under it, so that needs an explicit
 * HULY_UPLOAD_ROOT, which is held to the same rule.
 */
async function uploadRoots(): Promise<string[]> {
    if (process.env.HULY_UPLOAD_ROOT?.trim()) {
        const roots = (await allowedRoots('HULY_UPLOAD_ROOT')).roots;
        for (const root of roots) {
            if (await tooBroad(root)) {
                throw hulyError(
                    'invalid_input',
                    `HULY_UPLOAD_ROOT ${root} is too broad to upload from; set it to the directory that holds the files`,
                );
            }
        }
        return roots;
    }
    const cwd = await realpath(process.cwd());
    if (await tooBroad(cwd)) {
        throw hulyError(
            'invalid_input',
            `The working directory ${cwd} is too broad to upload from; set HULY_UPLOAD_ROOT to the directory that holds the files`,
        );
    }
    return [cwd];
}

/**
 * Home itself or any directory above it (`/Users`, `/`), and the shared temp
 * directory itself; a project or scratch directory below them is fine. Temp
 * means `tmpdir()` and its parent (on macOS the per-user folder that also holds
 * the cache directory) and the shared `/tmp` (`/private/tmp` on macOS).
 */
async function tooBroad(dir: string): Promise<boolean> {
    const home = await realpath(homedir()).catch(() => homedir());
    const temp = await realpath(tmpdir()).catch(() => tmpdir());
    const temps = [temp, dirname(temp)];
    for (const shared of ['/tmp', '/private/tmp']) {
        temps.push(await realpath(shared).catch(() => shared));
    }
    const homeRel = relative(dir, home);
    const holdsHome = homeRel === '' || (!homeRel.startsWith('..') && !isAbsolute(homeRel));
    return holdsHome || temps.includes(dir) || dir === parse(dir).root;
}

/**
 * Text in the very issue an agent is working on can talk it into any path, so
 * a file is read only when its real path sits inside an allowed root and no
 * part of it below that root is hidden (`.env`, `.ssh/…`), including what a
 * symlink points to. Errors name the path as given, never where it resolved.
 */
async function readAllowed(input: string, roots: string[], caps: UploadLimits, used: number): Promise<PreparedFile> {
    const cap = caps.maxFileBytes;
    const left = caps.maxTotalBytes - used;
    const path = resolve(input);
    let real: string;
    try {
        real = await realpath(path);
    } catch (e: any) {
        throw hulyError('invalid_input', `File cannot be read: ${input} (${e?.code ?? 'unknown'})`);
    }

    const rel = relativeToRoot(real, roots);
    if (rel === null) {
        throw hulyError(
            'invalid_input',
            `${input} is outside ${roots.join(' or ')}; set HULY_UPLOAD_ROOT to allow another directory`,
        );
    }
    if (rel.split(sep).some((segment) => segment.startsWith('.'))) {
        throw hulyError('invalid_input', `${input} is a hidden file or inside a hidden directory`);
    }
    // The name as given and the name it resolves to, so a link cannot rename a key.
    const secret = secretPattern(basename(path)) ?? secretPattern(basename(real));
    if (secret) {
        throw hulyError('invalid_input', `${input} looks like a key, certificate or credential file (${secret}) and is never uploaded`);
    }

    // The real path is opened without following a final symlink, so swapping
    // the file for one after the check fails instead of reading elsewhere.
    // O_NONBLOCK keeps a FIFO from hanging the open; fstat then refuses it.
    let handle: FileHandle;
    try {
        handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (e: any) {
        throw hulyError('invalid_input', `File cannot be read: ${input} (${e?.code ?? 'unknown'})`);
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw hulyError('invalid_input', `${input} is not a regular file`);
        if (stat.size > cap) throw overCap(input, stat.size, cap);
        // Refused from the size alone, so a file past the call total is never read.
        if (stat.size > left) throw overTotal(caps.maxTotalBytes);
        const data = await readCapped(handle, Math.min(cap, left));
        // A file that grew after fstat is judged by what was actually read.
        if (data.byteLength > cap) throw overCap(input, data.byteLength, cap);
        if (data.byteLength > left) throw overTotal(caps.maxTotalBytes);
        const name = basename(path);
        return { path, name, type: mimeTypeFor(name), size: data.byteLength, lastModified: Math.round(stat.mtimeMs), data };
    } finally {
        await handle.close().catch(() => {});
    }
}

/**
 * Base names refused as likely secrets, case-insensitively, even when not
 * hidden: an agent's working directory is often a repository holding them.
 * Kept short and listed in the docs; a name can still hide a secret.
 */
const SECRET_NAMES: { label: string; pattern: RegExp }[] = [
    { label: '*.pem, *.key, *.p12, *.pfx', pattern: /\.(pem|key|p12|pfx)$/i },
    { label: 'id_rsa, id_dsa, id_ecdsa, id_ed25519', pattern: /^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/i },
    { label: '*.tfstate', pattern: /\.tfstate(\.|$)/i },
    { label: 'credential, secret, service-account', pattern: /credential|secret|service[-_]?account/i },
];

function secretPattern(name: string): string | null {
    return SECRET_NAMES.find((s) => s.pattern.test(name))?.label ?? null;
}

function relativeToRoot(real: string, roots: string[]): string | null {
    for (const root of roots) {
        const rel = relative(root, real);
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
    }
    return null;
}

/** Read at most cap + 1 bytes, enough to tell a file over the cap without reading all of it. */
export async function readCapped(handle: Pick<FileHandle, 'read'>, cap: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const chunk = Buffer.alloc(Math.min(1024 * 1024, cap + 1 - total));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        chunks.push(chunk.subarray(0, bytesRead));
        total += bytesRead;
        if (total > cap) break;
    }
    return Buffer.concat(chunks, total);
}

function overCap(input: string, size: number, cap: number) {
    return hulyError('invalid_input', `${input} is ${formatSize(size)}, over the ${formatSize(cap)} limit per file`);
}

function overTotal(total: number) {
    return hulyError('invalid_input', `Files total over the ${formatSize(total)} limit for one call`);
}

/**
 * Send prepared files one by one. The task is looked up first, so an unknown
 * task leaves nothing behind. A failure on one file is reported on that file
 * and the rest still go, except a refused credential or a dropped connection,
 * which every later file would hit too: that ends the call as an error naming
 * what already went up, so a retry does not attach those twice. A blob whose
 * record was refused is removed again; after a dropped connection the record
 * may exist, so the blob is kept rather than left for a record to point at.
 */
export async function attachPrepared(
    source: AttachmentUploadSource,
    taskId: string,
    files: PreparedFile[],
): Promise<{ taskId: string; uploaded: number; failed: number; files: UploadedFile[] }> {
    const task = await source.getTask(taskId);
    if (!task) throw hulyError('not_found', `Task not found: ${taskId}`);

    const results: UploadedFile[] = [];
    for (const file of files) {
        const entry: UploadedFile = {
            path: file.path,
            name: file.name,
            type: file.type,
            size: file.size,
            attachmentId: null,
            blobId: null,
        };
        // Kept so a blob that may have landed before a dropped connection can be named.
        const key = blobObjectName();
        let blobId: string | null = null;
        try {
            blobId = (await source.uploadBlob({ key, name: file.name, data: file.data, type: file.type }))._id;
            entry.attachmentId = await source.addIssueAttachment(task, {
                name: file.name,
                file: blobId,
                type: file.type,
                size: file.size,
                lastModified: file.lastModified,
            });
            entry.blobId = blobId;
        } catch (e) {
            const fatal = callErrorCode(e);
            const keepBlob = fatal === 'connection' && blobId !== null;
            if (blobId && !keepBlob) {
                try {
                    await source.removeBlob(blobId);
                } catch (removeError) {
                    // Still on the server: say so rather than lose track of it.
                    entry.blobId = blobId;
                    entry.cleanupError = describeError(removeError);
                }
            }
            if (fatal) throw callFailure(e, fatal, entry, keepBlob ? blobId : null, blobId ? null : key, results);
            entry.uploadError = describeError(e);
        }
        results.push(entry);
    }
    const failed = results.filter((r) => r.uploadError !== undefined).length;
    return { taskId, uploaded: results.length - failed, failed, files: results };
}

function callFailure(
    e: unknown,
    code: CallErrorCode,
    entry: UploadedFile,
    keptBlob: string | null,
    pendingKey: string | null,
    done: UploadedFile[],
) {
    const parts = [`Upload of ${entry.name} failed: ${describeError(e)}`];
    if (keptBlob) parts.push(`its stored file ${keptBlob} was kept, since the attachment may already have been recorded`);
    // The thrown error is all the caller gets, so every blob left behind, by this
    // file or an earlier one, must be named in it.
    if (entry.cleanupError) parts.push(`its stored file ${entry.blobId} could not be removed: ${entry.cleanupError}`);
    for (const earlier of done.filter((d) => d.cleanupError)) {
        parts.push(`the stored file ${earlier.blobId} of ${earlier.name} could not be removed: ${earlier.cleanupError}`);
    }
    const mayHaveStored = pendingKey !== null && code === 'connection';
    if (mayHaveStored) parts.push(`if it was stored before the failure, it is under ${pendingKey}`);
    const attached = done.filter((d) => d.attachmentId);
    if (attached.length > 0) {
        parts.push(`already attached: ${attached.map((d) => `${d.name} (${d.attachmentId})`).join(', ')}; send only the other files again`);
    }
    // Repeating the same call would attach those files twice, or store this one
    // twice: a timed-out upload keeps running and may still land under the key.
    const retryable = attached.length > 0 || keptBlob || mayHaveStored ? { retryable: false } : {};
    return Object.assign(hulyError(code, parts.join('; ')), { cause: e }, retryable);
}
