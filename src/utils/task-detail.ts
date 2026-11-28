import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

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

export interface TaskDetailSource {
    fetchMarkup(doc: any, field: string): Promise<string | null>;
    getAttachments(issueId: string): Promise<any[]>;
    downloadBlob(blobId: string): Promise<Buffer>;
    /** Web link of the issue; optional so a source without it still works. */
    getIssueUrl?(identifier: string): Promise<string | null>;
}

export interface TaskDetailOptions {
    /** Save every attachment here; omitted means metadata only. */
    downloadDir?: string;
}

// Most filesystems cap a single name at 255 bytes.
const MAX_NAME_BYTES = 255;

export async function buildTaskDetail<T extends Record<string, any>>(
    source: TaskDetailSource,
    task: T,
    options: TaskDetailOptions = {},
): Promise<T & { descriptionMarkdown: string | null; attachmentFiles: AttachmentInfo[]; url: string | null }> {
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

    if (options.downloadDir && attachmentFiles.length > 0) {
        await saveAttachments(source, attachmentFiles, resolve(options.downloadDir));
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
        _id: doc._id,
        name: typeof doc.name === 'string' ? doc.name : null,
        type: typeof doc.type === 'string' ? doc.type : null,
        size: typeof doc.size === 'number' ? doc.size : null,
        blobId: typeof doc.file === 'string' ? doc.file : null,
        lastModified: typeof doc.lastModified === 'number' ? doc.lastModified : null,
    };
}

async function saveAttachments(source: TaskDetailSource, files: AttachmentInfo[], dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    // Sequential on purpose: name collisions are resolved against what is
    // already on disk, which a parallel write would race.
    for (const file of files) {
        if (!file.blobId) {
            file.downloadError = 'Attachment has no stored file';
            continue;
        }
        try {
            const data = await source.downloadBlob(file.blobId);
            file.localPath = await writeUnique(dir, safeFileName(file.name, file._id), data);
        } catch (e: any) {
            file.downloadError = e?.message || String(e);
        }
    }
}

/** Reduce an uploaded name to a single path segment that cannot leave the target directory. */
function safeFileName(name: string | null, fallback: string): string {
    let base = (name ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]/g, '_')
        .trim()
        .replace(/^\.+/, '');
    if (!base) base = `attachment-${fallback}`.replace(/[\\/]/g, '_');
    return truncateName(base, MAX_NAME_BYTES);
}

function truncateName(name: string, maxBytes: number): string {
    if (Buffer.byteLength(name) <= maxBytes) return name;
    const ext = extname(name);
    const keepExt = Buffer.byteLength(ext) < maxBytes / 2 ? ext : '';
    let stem = name.slice(0, name.length - keepExt.length);
    while (Buffer.byteLength(stem + keepExt) > maxBytes) stem = stem.slice(0, -1);
    return stem + keepExt;
}

/** Write without ever replacing an existing file: `spec.pdf`, then `spec-1.pdf`, `spec-2.pdf`, … */
async function writeUnique(dir: string, name: string, data: Buffer): Promise<string> {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 0; ; i++) {
        const candidate = i === 0 ? name : truncateName(`${stem}-${i}`, MAX_NAME_BYTES - Buffer.byteLength(ext)) + ext;
        const path = join(dir, candidate);
        try {
            await writeFile(path, data, { flag: 'wx' });
            return path;
        } catch (e: any) {
            if (e?.code !== 'EEXIST') throw e;
        }
    }
}

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
