import { z } from 'zod';

/**
 * Input of `huly_get_task`. `downloadDir` writes to the server's own disk, so
 * it exists only where server and caller share that disk (stdio). Over HTTP a
 * remote caller could not read the files anyway, and the strict schema then
 * rejects the argument instead of writing anywhere.
 */
export function getTaskInputSchema(allowDownloads = false) {
    const base = {
        taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
    };
    if (!allowDownloads) return z.object(base).strict();
    return z.object({
        ...base,
        downloadDir: z.string().optional().describe(
            'Directory to save every attachment into, inside HULY_DOWNLOAD_ROOT (default: the working or temp directory); each entry then carries `localPath` (or `downloadError`). Omit for metadata only.',
        ),
    }).strict();
}

/**
 * Tool options per transport. Only stdio, where server and caller share a
 * disk, may write downloads; anything else gets metadata only.
 */
export function serverOptionsFor(transport: 'stdio' | 'http'): { allowDownloads: boolean } {
    return { allowDownloads: transport === 'stdio' };
}
