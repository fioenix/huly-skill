import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
}

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
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
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
        pending ??= factory().catch((e) => {
            pending = null;
            throw e;
        });
        return pending;
    };
    return Object.assign(get, { reset: () => { pending = null; } });
}

export function isSafeBlobId(blobId: string): boolean {
    return SAFE_BLOB_ID.test(blobId) && blobId !== '.' && blobId !== '..';
}

export async function buildTaskDetail<T extends Record<string, any>>(
    source: TaskDetailSource,
    task: T,
    options: TaskDetailOptions = {},
): Promise<T & { descriptionMarkdown: string | null; attachmentFiles: AttachmentInfo[]; url: string | null }> {
    // Refuse a bad directory before any network work, so the caller learns
    // about it without anything having been created.
    const downloadDir = options.downloadDir === undefined ? null : await resolveDownloadDir(options.downloadDir);

    // A missing or unreadable description must not cost the caller the rest of
    // the detail; an unreadable attachment list must, since an empty list would
    // claim there are no files.
    let descriptionMarkdown: string | null = null;
    if (task.description) {
        try {
            descriptionMarkdown = (await source.fetchMarkup(task, 'description')) || null;
        } catch {
            descriptionMarkdown = null;
        }
    }

    const docs = await source.getAttachments(task._id);
    const attachmentFiles = docs.map(toAttachmentInfo);

    if (downloadDir && attachmentFiles.length > 0) {
        await saveAttachments(source, attachmentFiles, downloadDir, { ...DEFAULT_LIMITS, ...options.limits });
    }

    // Like the description, a failed link lookup must not cost the rest of the detail.
    let url: string | null = null;
    if (source.getIssueUrl && task.identifier) {
        try {
            url = await source.getIssueUrl(task.identifier);
        } catch {
            url = null;
        }
    }

    return { ...task, descriptionMarkdown, attachmentFiles, url };
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
    // but decide on the real one.
    const path = resolve(trimmed);
    const target = await realpathOfNearest(path);
    const roots = await allowedRoots();
    for (const root of roots) {
        const rel = relative(root, target);
        if (rel.startsWith('..') || isAbsolute(rel)) continue;
        if (rel.split(sep).some((segment) => segment.startsWith('.'))) {
            throw hulyError('invalid_input', `downloadDir must not be inside a hidden directory: ${target}`);
        }
        return { path, real: target };
    }
    throw hulyError(
        'invalid_input',
        `downloadDir must be inside ${roots.join(' or ')}; set HULY_DOWNLOAD_ROOT to allow another directory`,
    );
}

async function allowedRoots(): Promise<string[]> {
    const configured = process.env.HULY_DOWNLOAD_ROOT?.trim();
    const candidates = configured ? [resolve(configured)] : [process.cwd(), tmpdir()];
    const roots: string[] = [];
    for (const candidate of candidates) {
        try {
            roots.push(await realpath(candidate));
        } catch {
            // A root that does not exist cannot contain anything.
        }
    }
    if (configured && roots.length === 0) {
        throw hulyError('invalid_input', `HULY_DOWNLOAD_ROOT does not exist: ${configured}`);
    }
    return roots;
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
    const dir = target.path;
    await mkdir(dir, { recursive: true });
    // The directory may have been swapped for a symlink since it was checked.
    if ((await realpath(dir)) !== target.real) {
        throw hulyError('invalid_input', `downloadDir changed while saving: ${dir}`);
    }

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
            file.localPath = saved.path;
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
        const opened = await openUnique(dir, name);
        if (cancelled) {
            // The timeout won the race while the file was being created.
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
            await handle!.write(chunk);
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
    if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
    return truncateName(base, MAX_NAME_BYTES);
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
    const message = String(err?.message ?? '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const text = message || (typeof err?.name === 'string' && err.name) || String(e) || 'Download failed';
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
