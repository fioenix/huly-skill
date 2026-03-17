import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole } from '../utils/logger.js';

export function deleteTaskCommand() {
    return new Command('delete')
        .arguments('task <taskId>')
        .description('Delete a task permanently')
        .action(async (type, taskId) => {
            // Note: commander treats the arg structure as delete task <taskId>,
            // so we skip validation of type='task' explicitly here.

            const client = new HulyClient();
            try {
                await client.connect();

                const task = await client.getTask(taskId);
                if (!task) {
                    console.log(`❌ Không tìm thấy task với Identifier: ${taskId}`);
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
