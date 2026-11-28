import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hulyError } from './errors.js';

/**
 * Everything an agent needs to work a task from its detail alone: the
 * description as markdown and the files attached to the issue. Shared by the
 * `huly task` command and the `huly_get_task` MCP tool so both return the
 * same fields.
 */

export interface AttachmentInfo {
    _id: string;
    name: string | null;
    type: string | null;
    size: number | null;
    blobId: string | null;
    lastModified: number | null;
    localPath?: string;
    downloadError?: string;
}

export type BlobData = Uint8Array | AsyncIterable<Uint8Array>;

export interface TaskDetailSource {
    fetchMarkup(doc: any, field: string): Promise<string | null>;
    getAttachments(issueId: string): Promise<any[]>;
    /** A buffer, or a stream that is written to disk as it arrives. */
    downloadBlob(blobId: string): Promise<BlobData>;
    /** Web link of the issue; optional so a source without it still works. */
    getIssueUrl?(identifier: string): Promise<string | null>;
}

export interface DownloadLimits {
    maxFileBytes?: number;
    maxTotalBytes?: number;
    timeoutMs?: number;
}

export interface TaskDetailOptions {
    /**
     * Save every attachment here; omitted means metadata only. Must resolve
     * inside HULY_DOWNLOAD_ROOT, or the working or temp directory when unset.
     */
    downloadDir?: string;
    limits?: DownloadLimits;
    /** How long the web-link lookup may take before `url` is left null. */
    linkTimeoutMs?: number;
}

/**
 * The link lookup goes to the account service after everything else is done;
 * a hang there must not hold back a detail, or a task already created.
 */
export const DEFAULT_LINK_TIMEOUT_MS = 5_000;

const MiB = 1024 * 1024;
export const DEFAULT_LIMITS: Required<DownloadLimits> = {
    maxFileBytes: 100 * MiB,
    maxTotalBytes: 500 * MiB,
    timeoutMs: 120_000,
};

/** Query options for an issue's attachments: a stable order, so `spec-1.pdf` names the same file every run. */
// `1` is SortingOrder.Ascending; core is not imported here so this module stays
// loadable outside the bundle (see tests/task-detail-hardening.test.ts).
export const ATTACHMENT_QUERY = { sort: { modifiedOn: 1 }, limit: 500 } as const;

// Most filesystems cap a single name at 255 bytes.
const MAX_NAME_BYTES = 255;
const MAX_NAME_ATTEMPTS = 1000;
const MAX_ERROR_CHARS = 200;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\.|$)/i;
// Huly blob ids are UUID-like. Anything else would be spliced into the files
// URL next to the workspace token, so refuse it rather than escape it.
const SAFE_BLOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Cache a promise only once it resolves, so a transient failure (a dropped
 * connection while fetching the storage config) is retried on the next call
 * instead of failing every later one.
 */
export function memoizeSuccess<T>(factory: () => Promise<T>): (() => Promise<T>) & { reset(): void } {
    let pending: Promise<T> | null = null;
    const get = () => {
        if (!pending) {
            const attempt: Promise<T> = factory().catch((e) => {
                // Only forget this attempt; a reset() may already have started a newer one.
                if (pending === attempt) pending = null;
                throw e;
            });
            pending = attempt;
        }
        return pending;
    };
    return Object.assign(get, { reset: () => { pending = null; } });
}

/** Reject with `message` when `promise` has not settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    // unref: a bounded wait must not itself keep a finished CLI process alive.
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms).unref(); });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export function isSafeBlobId(blobId: string): boolean {
    return SAFE_BLOB_ID.test(blobId) && blobId !== '.' && blobId !== '..';
}

/** Each limit from the caller, or the default when it is absent or not a positive number. */
function resolveLimits(limits: DownloadLimits = {}): Required<DownloadLimits> {
    const pick = (value: number | undefined, fallback: number) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
    return {
        maxFileBytes: pick(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
        maxTotalBytes: pick(limits.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes),
        timeoutMs: pick(limits.timeoutMs, DEFAULT_LIMITS.timeoutMs),
    };
}

export async function buildTaskDetail<T extends Record<string, any>>(
    source: TaskDetailSource,
    task: T,
    options: TaskDetailOptions = {},
): Promise<T & {
    descriptionMarkdown: string | null;
    descriptionError?: string;
    attachmentFiles: AttachmentInfo[];
    url: string | null;
}> {
    // Refuse a bad directory before any network work, so the caller learns
    // about it without anything having been created.
    const downloadDir = options.downloadDir === undefined ? null : await resolveDownloadDir(options.downloadDir);

    // A missing or unreadable description must not cost the caller the rest of
    // the detail; an unreadable attachment list must, since an empty list would
    // claim there are no files. An unreadable description is still reported,
    // so an agent does not mistake it for a task without one.
    let descriptionMarkdown: string | null = null;
    let descriptionError: string | undefined;
    if (task.description) {
        try {
            descriptionMarkdown = (await source.fetchMarkup(task, 'description')) || null;
        } catch (e) {
            descriptionError = describeError(e);
        }
    }

    const docs = await source.getAttachments(task._id);
    const attachmentFiles = docs.map(toAttachmentInfo);

    if (downloadDir && attachmentFiles.length > 0) {
        await saveAttachments(source, attachmentFiles, downloadDir, resolveLimits(options.limits));
    }

    // Like the description, a failed or slow link lookup must not cost the rest of the detail.
    const url = task.identifier
        ? await issueUrlWithin(source, task.identifier, options.linkTimeoutMs ?? DEFAULT_LINK_TIMEOUT_MS)
        : null;

    return { ...task, descriptionMarkdown, ...(descriptionError ? { descriptionError } : {}), attachmentFiles, url };
}

/** The issue's web link, or null when the source has none, the lookup fails, or it outlasts `ms`. */
export async function issueUrlWithin(source: Pick<TaskDetailSource, 'getIssueUrl'>, identifier: string, ms: number): Promise<string | null> {
    if (!source.getIssueUrl) return null;
    let timer: NodeJS.Timeout | undefined;
    // Kept referenced: this timer is what produces the null the caller is waiting for.
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
    try {
        // Through then(), so a lookup that throws synchronously still yields null.
        const lookup = Promise.resolve().then(() => source.getIssueUrl!(identifier)).catch(() => null);
        return await Promise.race([lookup, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function toAttachmentInfo(doc: any): AttachmentInfo {
    return {
        _id: typeof doc._id === 'string' ? doc._id : String(doc._id ?? ''),
        name: typeof doc.name === 'string' ? doc.name : null,
        type: typeof doc.type === 'string' ? doc.type : null,
        size: isCount(doc.size) ? doc.size : null,
        blobId: typeof doc.file === 'string' ? doc.file : null,
        lastModified: isCount(doc.lastModified) ? doc.lastModified : null,
    };
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// --- where files may go ----------------------------------------------------

/**
 * An agent can be talked into any path by text in the very issue it is
 * reading, so the directory must sit inside an allowed root once symlinks are
 * resolved, and never in a hidden directory such as `.git` or `.ssh`.
 */
async function resolveDownloadDir(input: string): Promise<{ path: string; real: string }> {
    const trimmed = input.trim();
    if (!trimmed) throw hulyError('invalid_input', 'downloadDir is empty');

    // Report paths the way the caller wrote them (macOS /var is /private/var),
    // but decide on the real one. No shell expands `~` for an MCP caller.
    const path = resolve(expandHome(trimmed));
    const target = await realpathOfNearest(path);
    const { roots, skippedCwd } = await allowedRoots();
    for (const root of roots) {
        const rel = relative(root, target);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        if (rel.split(sep).some((segment) => segment.startsWith('.'))) {
            throw hulyError('invalid_input', `downloadDir must not be inside a hidden directory: ${target}`);
        }
        return { path, real: target };
    }
    throw hulyError(
        'invalid_input',
        `downloadDir must be inside ${roots.join(' or ')}` +
            (skippedCwd ? ` (the working directory ${skippedCwd} is not a download root because it is / or contains the home directory)` : '') +
            '; set HULY_DOWNLOAD_ROOT to allow another directory',
    );
}

function expandHome(path: string): string {
    if (path === '~') return homedir();
    if (path.startsWith('~/') || path.startsWith(`~${sep}`)) return join(homedir(), path.slice(2));
    return path;
}

async function allowedRoots(): Promise<{ roots: string[]; skippedCwd?: string }> {
    const configured = process.env.HULY_DOWNLOAD_ROOT?.trim();
    const candidates = configured ? [resolve(expandHome(configured))] : [process.cwd(), tmpdir()];
    const home = await realpath(homedir()).catch(() => resolve(homedir()));
    const roots: string[] = [];
    let skippedCwd: string | undefined;
    for (const candidate of candidates) {
        try {
            const root = await realpath(candidate);
            // An MCP client often starts the server in / or the home directory.
            // As a default root that would admit ~/Library/LaunchAgents or
            // ~/bin, so a working directory that broad does not count.
            if (!configured && candidate === process.cwd() && isAncestorOrSelf(root, home)) {
                skippedCwd = root;
                continue;
            }
            roots.push(root);
        } catch {
            // A root that does not exist cannot contain anything.
        }
    }
    if (configured && roots.length === 0) {
        throw hulyError('invalid_input', `HULY_DOWNLOAD_ROOT does not exist: ${configured}`);
    }
    return { roots, skippedCwd };
}

function isAncestorOrSelf(dir: string, of: string): boolean {
    const rel = relative(dir, of);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** realpath of the deepest existing ancestor, with the not-yet-created tail appended. */
async function realpathOfNearest(path: string): Promise<string> {
    const tail: string[] = [];
    let current = path;
    for (;;) {
        try {
            return join(await realpath(current), ...tail.reverse());
        } catch (e: any) {
            const parent = dirname(current);
            // A dangling symlink also reports ENOENT, yet mkdir would follow it
            // to wherever it points; only a truly absent entry may be created.
            const absent = e?.code === 'ENOENT' && !(await lstat(current).then(() => true, () => false));
            if (!absent || parent === current) {
                throw hulyError('invalid_input', `downloadDir cannot be used: ${current} (${e?.code ?? 'unknown'})`);
            }
            tail.push(basename(current));
            current = parent;
        }
    }
}

// --- saving ----------------------------------------------------------------

async function saveAttachments(
    source: TaskDetailSource,
    files: AttachmentInfo[],
    target: { path: string; real: string },
    limits: Required<DownloadLimits>,
): Promise<void> {
    // Network calls ran since the check; a parent swapped for a symlink in the
    // meantime would make mkdir create directories wherever it points.
    if ((await realpathOfNearest(target.path)) !== target.real) {
        throw hulyError('invalid_input', `downloadDir changed while saving: ${target.path}`);
    }
    try {
        await mkdir(target.path, { recursive: true });
    } catch (e: any) {
        throw hulyError('invalid_input', `downloadDir cannot be created: ${target.path} (${e?.code ?? 'unknown'})`);
    }
    // The directory may have been swapped for a symlink since it was checked.
    const real = await realpath(target.path).catch(() => null);
    if (real !== target.real) {
        throw hulyError('invalid_input', `downloadDir changed while saving: ${target.path}`);
    }
    // Write through the checked real path, so a parent swapped for a symlink
    // after this point cannot redirect the files; report the caller's form.
    const dir = target.real;

    let remaining = limits.maxTotalBytes;
    // Sequential on purpose: name collisions are resolved against what is
    // already on disk, which a parallel write would race.
    for (const file of files) {
        try {
            if (!file.blobId) throw new Error('Attachment has no stored file');
            if (!isSafeBlobId(file.blobId)) throw new Error('Attachment has an invalid file reference');
            const cap = Math.min(limits.maxFileBytes, remaining);
            if (cap <= 0) throw new Error(`Download total reached the ${formatSize(limits.maxTotalBytes)} limit`);
            if (file.size !== null && file.size > cap) {
                throw new Error(`File is ${formatSize(file.size)}, over the ${formatSize(cap)} download limit`);
            }
            const saved = await downloadTo(source, file.blobId, dir, safeFileName(file.name, file._id), cap, limits.timeoutMs);
            file.localPath = join(target.path, basename(saved.path));
            remaining -= saved.bytes;
        } catch (e) {
            file.downloadError = describeError(e);
        }
    }
}

async function downloadTo(
    source: TaskDetailSource,
    blobId: string,
    dir: string,
    name: string,
    cap: number,
    timeoutMs: number,
): Promise<{ path: string; bytes: number }> {
    let handle: FileHandle | null = null;
    let path: string | null = null;
    let data: BlobData | null = null;
    let cancelled = false;

    const work = (async () => {
        data = await source.downloadBlob(blobId);
        if (cancelled) {
            // The timeout fired while waiting for the response: drop the body
            // so its socket is released, and never create the file, which
            // could otherwise take the name of the next one.
            (data as any)?.destroy?.();
            throw new Error('Download cancelled');
        }
        const opened = await openUnique(dir, name);
        if (cancelled) {
            // The timeout won the race while the file was being created.
            (data as any)?.destroy?.();
            await opened.handle.close().catch(() => {});
            await unlink(opened.path).catch(() => {});
            throw new Error('Download cancelled');
        }
        ({ handle, path } = opened);
        let bytes = 0;
        for await (const chunk of chunksOf(data)) {
            if (cancelled) throw new Error('Download cancelled');
            bytes += chunk.byteLength;
            if (bytes > cap) throw new Error(`File is over the ${formatSize(cap)} download limit`);
            // One write may store less than asked; keep going until the chunk is down.
            for (let offset = 0; offset < chunk.byteLength;) {
                const { bytesWritten } = await handle!.write(chunk, offset, chunk.byteLength - offset);
                if (cancelled) throw new Error('Download cancelled');
                if (bytesWritten <= 0) throw new Error('Could not write the file');
                offset += bytesWritten;
            }
        }
        return bytes;
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Download timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    });

    try {
        const bytes = await Promise.race([work, timeout]);
        await (handle as FileHandle | null)?.close();
        return { path: path!, bytes };
    } catch (e) {
        cancelled = true;
        work.catch(() => {});
        (data as any)?.destroy?.();
        await (handle as FileHandle | null)?.close().catch(() => {});
        if (path) await unlink(path).catch(() => {});
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function chunksOf(data: BlobData): AsyncIterable<Uint8Array> | Iterable<Uint8Array> {
    return data instanceof Uint8Array ? [data] : data;
}

/** Create the file without ever replacing one: `spec.pdf`, then `spec-1.pdf`, `spec-2.pdf`, … */
async function openUnique(dir: string, name: string): Promise<{ handle: FileHandle; path: string }> {
    const ext = extname(name);
    const keepExt = byteLength(ext) < MAX_NAME_BYTES / 2 ? ext : '';
    const stem = name.slice(0, name.length - keepExt.length);
    for (let i = 0; i < MAX_NAME_ATTEMPTS; i++) {
        // The suffix is reserved before the stem is cut, so a name already at
        // the byte limit still changes from one attempt to the next.
        const suffix = i === 0 ? '' : `-${i}`;
        const candidate = i === 0 ? name : cutToBytes(stem, MAX_NAME_BYTES - byteLength(suffix + keepExt)) + suffix + keepExt;
        const path = join(dir, candidate);
        try {
            return { handle: await open(path, 'wx'), path };
        } catch (e: any) {
            if (e?.code !== 'EEXIST') throw e;
        }
    }
    throw new Error(`More than ${MAX_NAME_ATTEMPTS} files named ${name} already exist`);
}

// --- names -----------------------------------------------------------------

/** Reduce an uploaded name to a single path segment that is valid on macOS, Linux and Windows. */
function safeFileName(name: string | null, fallback: string): string {
    let base = cleanName(name ?? '');
    if (!base) base = cleanName(`attachment-${fallback}`) || 'attachment';
    // Checked on the final name: cutting can strip the spaces that kept
    // 'CON   ….txt' from matching, and turn it into 'CON.txt'.
    const cut = truncateName(base, MAX_NAME_BYTES);
    return WINDOWS_RESERVED.test(cut) ? truncateName(`_${cut}`, MAX_NAME_BYTES) : cut;
}

function cleanName(value: string): string {
    return value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/^[\s.]+/, '')
        .replace(/[\s.]+$/, '');
}

function truncateName(name: string, maxBytes: number): string {
    if (byteLength(name) <= maxBytes) return name;
    const ext = extname(name);
    const keepExt = byteLength(ext) < maxBytes / 2 ? ext : '';
    // Cutting can expose a trailing dot or space, which Windows will not accept.
    const stem = cutToBytes(name.slice(0, name.length - keepExt.length), maxBytes - byteLength(keepExt)).replace(/[\s.]+$/, '');
    return (stem || 'attachment') + keepExt;
}

/** Longest prefix within maxBytes, cut between characters so no surrogate pair is split. */
function cutToBytes(value: string, maxBytes: number): string {
    let out = '';
    let used = 0;
    for (const char of value) {
        const size = byteLength(char);
        if (used + size > maxBytes) break;
        out += char;
        used += size;
    }
    return out;
}

function byteLength(value: string): number {
    return Buffer.byteLength(value);
}

/** One short line: upstream errors can carry a whole HTML error page. */
function describeError(e: unknown): string {
    const err = e as { message?: unknown; name?: unknown };
    const oneLine = (value: unknown) => String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // Clean whichever text is used: a thrown string or an odd name can carry
    // newlines and escapes just like a message.
    const text = oneLine(err?.message) || oneLine(err?.name) || oneLine(e) || 'Download failed';
    const chars = Array.from(text); // by code point, so no surrogate pair is split
    return chars.length > MAX_ERROR_CHARS ? `${chars.slice(0, MAX_ERROR_CHARS - 1).join('')}…` : text;
}

// --- text output -----------------------------------------------------------

export function formatAttachmentLines(files: AttachmentInfo[]): string {
    if (files.length === 0) return '';
    let out = `📎 Attachments (${files.length}):\n`;
    for (const file of files) {
        const meta = [file.type, file.size === null ? null : formatSize(file.size)].filter(Boolean).join(', ');
        out += `  - ${file.name ?? file._id}${meta ? ` (${meta})` : ''}`;
        if (file.localPath) out += ` → ${file.localPath}`;
        if (file.downloadError) out += ` ⚠️ download failed: ${file.downloadError}`;
        out += '\n';
    }
    return out;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
