import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS, isJsonMode, outputJson } from '../utils/logger.js';
import { getProjectMap, getStatusMap } from '../resolvers.js';

export function getTaskCommand() {
    return new Command('task')
        .description('Get task details by ID')
        .argument('<taskId>', 'Task identifier (e.g., DELTA-123)')
        .action(async (taskId) => {
            try {
                await withClient(async (client) => {
                    const task = await client.getTask(taskId);
                    if (!task) {
                        if (isJsonMode()) outputJson({ status: 'error', error: `Task not found: ${taskId}` });
                        else console.error(`❌ Khong tim thay cong viec: ${taskId}`);
                        process.exitCode = 1;
                        return;
                    }

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: task });
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
                        try {
                            const descContent = await client.fetchMarkup(task, 'description');
                            if (descContent) output += `📝 Mo ta:\n${descContent}\n`;
                            else output += `📝 Mo ta: (khong doc duoc noi dung)\n`;
                        } catch {
                            output += `📝 Mo ta: (khong doc duoc noi dung)\n`;
                        }
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
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`❌ Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
