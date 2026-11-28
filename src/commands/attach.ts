import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor } from '../utils/errors.js';
import { attachExitCode, attachPrepared, formatAttachText, prepareUploads } from '../utils/attachment-upload.js';

export function attachCommand() {
    return new Command('attach')
        .description('Upload local files as attachments of a task')
        .argument('<taskId>', 'Task identifier (e.g., DELTA-123)')
        .argument('<files...>', 'Files to attach, inside HULY_UPLOAD_ROOT (default: the working directory)')
        .action(async (taskId, files) => {
            try {
                // Checked and read before connecting, so a refused path costs no round trip.
                const prepared = await prepareUploads(files);
                const result = await withClient((client) => attachPrepared(client, taskId, prepared));

                if (isJsonMode()) {
                    outputJson({ status: 'ok', ...result });
                } else {
                    printToConsole(formatAttachText(taskId, result));
                }
                process.exitCode = attachExitCode(result);
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`❌ Could not attach the files: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
