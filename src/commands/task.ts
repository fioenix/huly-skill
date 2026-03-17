import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';

export function getTaskCommand() {
    return new Command('task')
        .description('Get task details by ID')
        .argument('<taskId>', 'Task identifier (e.g., DELTA-123)')
        .action(async (taskId) => {
            const client = new HulyClient();
            try {
                await client.connect();

                const task = await client.getTask(taskId);
                if (!task) {
                    printToConsole(`❌ Không tìm thấy công việc: ${taskId}`);
                    return;
                }

                const projects = await client.getProjects();
                const project = projects.find(p => p._id === task.space);

                const statuses = await client.getStatuses();
                const status = statuses.find(s => s._id === task.status);

                let assigneeName = 'Chưa giao';
                if (task.assignee) {
                    const persons = await client.getPersons();
                    const assignee = persons.find(p => p._id === task.assignee);
                    if (assignee) {
                        assigneeName = assignee.name || assignee.displayName || task.assignee;
                    }
                }

                let output = `📋 CHI TIẾT CÔNG VIỆC: ${task.identifier}\n\n`;
                output += `📌 Tiêu đề: ${task.title || 'N/A'}\n`;
                output += `📁 Dự án: ${project?.identifier || 'Unknown'} - ${project?.name || 'Unknown'}\n`;
                output += `📊 Trạng thái: ${status?.name || 'Unknown'}\n`;
                output += `🎯 Mức ưu tiên: ${PRIORITY_LABELS[task.priority] || 'KHÔNG ƯU TIÊN'}\n`;
                output += `👤 Người thực hiện: ${assigneeName}\n\n`;

                output += `📅 Ngày tạo: ${formatDate(task.createdOn, true)}\n`;
                output += `📅 Cập nhật: ${formatDate(task.modifiedOn, true)}\n`;
                output += `⏰ Hạn chót: ${task.dueDate ? formatDate(task.dueDate) : 'N/A'}\n\n`;

                if (task.description) {
                    output += `📝 ID Mô tả: ${task.description}\n`;
                }

                if (task.labels && task.labels.length > 0) {
                    output += `🏷️ Nhãn: ${task.labels.join(', ')}\n`;
                }

                if (task.attachments && task.attachments > 0) {
                    output += `📎 Đính kèm: ${task.attachments}\n`;
                }

                if (task.comments && task.comments > 0) {
                    output += `💬 Bình luận: ${task.comments}\n`;
                }

                printToConsole(output);
            } catch (e: any) {
                console.error(`❌ Lỗi: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
