import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole } from '../utils/logger.js';

export function deleteTaskCommand() {
    return new Command('delete')
        .arguments('task <taskId>')
        .description('Delete a task permanently (requires --yes)')
        .option('-y, --yes', 'Confirm deletion')
        .action(async (type, taskId, options) => {
            // Note: commander treats the arg structure as delete task <taskId>,
            // so we skip validation of type='task' explicitly here.

            if (!options?.yes) {
                printToConsole(
                    `⚠️ Lệnh này sẽ XOÁ VĨNH VIỄN task ${taskId}.\n` +
                    `Để xác nhận, hãy chạy lại với cờ --yes:\n\n` +
                    `huly delete task ${taskId} --yes\n`
                );
                return;
            }

            const client = new HulyClient();
            try {
                await client.connect();

                const task = await client.getTask(taskId);
                if (!task) {
                    printToConsole(`❌ Không tìm thấy task với Identifier: ${taskId}`);
                    return;
                }

                // Actually perform the deletion via client
                await client.deleteTask(taskId);

                let output = `✅ ĐÃ XOÁ TASK THÀNH CÔNG\n\n`;
                output += `🗑️ Task đã xoá: [${task.identifier}] ${task.title}\n`;

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Lỗi khi xoá task: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
