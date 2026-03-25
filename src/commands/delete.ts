import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';

export function deleteTaskCommand() {
    return new Command('delete')
        .arguments('task <taskId>')
        .description('Delete a task permanently (requires --yes)')
        .option('-y, --yes', 'Confirm deletion')
        .action(async (type, taskId, options) => {
            if (!options?.yes) {
                printToConsole(
                    `⚠️ Lenh nay se XOA VINH VIEN task ${taskId}.\n` +
                    `De xac nhan, hay chay lai voi co --yes:\n\n` +
                    `huly delete task ${taskId} --yes\n`
                );
                return;
            }

            try {
                await withClient(async (client) => {
                    const task = await client.getTask(taskId);
                    if (!task) {
                        console.error(`❌ Khong tim thay task voi Identifier: ${taskId}`);
                        process.exitCode = 1;
                        return;
                    }

                    await client.deleteTask(taskId);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', deleted: { identifier: task.identifier, title: task.title } });
                    } else {
                        let output = `✅ DA XOA TASK THANH CONG\n\n`;
                        output += `🗑️ Task da xoa: [${task.identifier}] ${task.title}\n`;
                        printToConsole(output);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`❌ Loi khi xoa task: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
