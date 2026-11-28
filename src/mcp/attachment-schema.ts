import { z } from 'zod';
import { UPLOAD_LIMITS } from '../utils/attachment-upload.js';

/**
 * Input of `huly_add_attachment`. The tool reads files from the server's own
 * disk, so it is registered only over stdio, where server and caller share
 * that disk; over HTTP a remote caller could otherwise pull files off the host.
 */
export const addAttachmentInputSchema = z.object({
    taskId: z.string().min(1).describe('Task identifier, e.g. DELTA-123'),
    paths: z.array(z.string().min(1)).min(1).max(UPLOAD_LIMITS.maxFiles).describe(
        `Local files to attach, at most ${UPLOAD_LIMITS.maxFiles}; each must be inside HULY_UPLOAD_ROOT (default: the working directory) and not hidden.`,
    ),
}).strict();
