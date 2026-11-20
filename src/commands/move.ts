import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor, hulyError } from '../utils/errors.js';

export function moveTaskCommand() {
    return new Command('move')
        .arguments('task <taskId>')
        .description('Re-parent a task: --parent <id> to move it under another task in the same project, --no-parent to make it top-level')
        .option('-p, --parent <parentId>', 'New parent task (identifier or internal _id)')
        .option('--no-parent', 'Detach from its parent')
        .action(async (_type, taskId, options) => {
            try {
                // commander turns --parent/--no-parent into options.parent: string | false | true(default)
                const parent = typeof options.parent === 'string' ? options.parent : null;
                if (parent === null && options.parent !== false) {
                    throw hulyError('invalid_input', 'Pass --parent <id> or --no-parent');
                }
                await withClient(async (client) => {
                    const r = await client.moveTask(taskId, parent);
                    const payload = {
                        status: 'ok',
                        moved: r.moved,
                        ...(r.reason ? { reason: r.reason } : {}),
                        task: { identifier: r.task.identifier, title: r.task.title },
                        from: r.from ? { identifier: r.from.identifier, title: r.from.parentTitle } : null,
                        to: r.to ? { identifier: r.to.identifier, title: r.to.parentTitle } : null,
                    };
                    if (isJsonMode()) outputJson(payload);
                    else if (!r.moved) printToConsole(`ℹ️ ${r.reason}`);
                    else printToConsole(`✅ Moved ${r.task.identifier}: ${payload.from?.identifier ?? '(no parent)'} → ${payload.to?.identifier ?? '(no parent)'}`);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`❌ Could not move the task: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
