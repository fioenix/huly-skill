import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';
import { getProjectMap, getStatusMap, resolvePerson } from '../resolvers.js';

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
                    printToConsole(`❌ Khong tim thay cong viec: ${taskId}`);
                    return;
                }

                const projectMap = await getProjectMap(client);
                const statusMap = await getStatusMap(client);
                const project = projectMap.get(task.space);
                const status = statusMap.get(task.status);

                let assigneeName = 'Chua giao';
                if (task.assignee) {
                    const persons = await client.getPersons();
                    const assignee = persons.find((p: any) => p._id === task.assignee);
                    if (assignee) {
                        assigneeName = assignee.name || assignee.displayName || task.assignee;
                    }
                }

                let output = `📋 CHI TIET CONG VIEC: ${task.identifier}\n\n`;
                output += `📌 Tieu de: ${task.title || 'N/A'}\n`;
                output += `📁 Du an: ${project?.identifier || 'Unknown'} - ${project?.name || 'Unknown'}\n`;
                output += `📊 Trang thai: ${status?.name || 'Unknown'}\n`;
                output += `🎯 Muc uu tien: ${PRIORITY_LABELS[task.priority] || 'KHONG UU TIEN'}\n`;
                output += `👤 Nguoi thuc hien: ${assigneeName}\n\n`;

                output += `📅 Ngay tao: ${formatDate(task.createdOn, true)}\n`;
                output += `📅 Cap nhat: ${formatDate(task.modifiedOn, true)}\n`;
                output += `⏰ Han chot: ${task.dueDate ? formatDate(task.dueDate) : 'N/A'}\n\n`;

                if (task.description) {
                    output += `📝 ID Mo ta: ${task.description}\n`;
                }

                if (task.labels && task.labels.length > 0) {
                    output += `🏷️ Nhan: ${task.labels.join(', ')}\n`;
                }

                if (task.attachments && task.attachments > 0) {
                    output += `📎 Dinh kem: ${task.attachments}\n`;
                }

                if (task.comments && task.comments > 0) {
                    output += `💬 Binh luan: ${task.comments}\n`;
                }

                printToConsole(output);
            } catch (e: any) {
                console.error(`❌ Loi: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
