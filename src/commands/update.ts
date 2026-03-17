import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole } from '../utils/logger.js';

export function updateTaskCommand() {
    return new Command('update')
        .arguments('task <taskId>')
        .description('Update a task by ID')
        .option('--status <statusName>', 'Set new status (e.g., Todo, In Progress, Done)')
        .option('--add-comment <comment>', 'Add a comment to the task')
        .action(async (type, taskId, options) => {
            // NOTE: We ignore type assuming it is purely 'task' syntax.
            const client = new HulyClient();
            try {
                await client.connect();

                const task = await client.getTask(taskId);
                if (!task) {
                    printToConsole(`❌ Không tìm thấy công việc: ${taskId}`);
                    return;
                }

                let updated = false;

                if (options.status) {
                    const statuses = await client.getStatuses();
                    const lowerName = options.status.toLowerCase();

                    // Look for status in current space or global
                    let matchedStatus = statuses.find(s =>
                        (s.space === task.space && s.name?.toLowerCase() === lowerName)
                    );

                    if (!matchedStatus) {
                        matchedStatus = statuses.find(s => s.name?.toLowerCase() === lowerName);
                    }

                    if (matchedStatus) {
                        await client.updateTask(taskId, { statusId: matchedStatus._id });
                        printToConsole(`✅ Đã cập nhật trạng thái của ${taskId} thành '${matchedStatus.name}'`);
                        updated = true;
                    } else {
                        printToConsole(`⚠️ Không tìm thấy trạng thái: '${options.status}'. Vui lòng kiểm tra lại tên.`);
                    }
                }

                if (options.addComment) {
                    await client.addComment(taskId, options.addComment);
                    printToConsole(`💬 Đã bình luận vào task ${taskId}`);
                    updated = true;
                }

                if (!updated) {
                    printToConsole(`ℹ️ Không có thông tin gì để cập nhật cho ${taskId}`);
                } else {
                    printToConsole(`✅ Cập nhật hoàn tất.`);
                }

            } catch (e: any) {
                console.error(`❌ Lỗi cập nhật task: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
