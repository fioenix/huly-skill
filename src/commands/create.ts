import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';

export function createTaskCommand() {
    return new Command('create')
        .arguments('task <title>')
        .description('Create a new task')
        .option('-p, --project <projectId>', 'Project identifier (e.g., DELTA, required)')
        .option('--priority <priority>', 'Priority level (0-4 or string LOW, MEDIUM, HIGH, URGENT)', '2')
        .option('--due <dueDate>', 'Due date (YYYY-MM-DD or "today", "tomorrow")')
        .option('-a, --assignee <assigneeId>', 'Assignee ID or "me"')
        .action(async (type, title, options) => {
            // NOTE: commander parses 'create task <title>' but the argument is type, title
            // We ignore type because we only support 'task' for now

            const client = new HulyClient();
            try {
                await client.connect();

                let projectId = options.project;
                if (!projectId) {
                    console.log(`❌ Phải có cờ --project (VD: --project DELTA)`);
                    return;
                }

                // Find project real ID
                let realProjectId;
                const projects = await client.getProjects();
                for (const p of projects) {
                    if (p.identifier === projectId || p.name === projectId || p._id === projectId) {
                        realProjectId = p._id;
                        projectId = p.identifier || p.name; // For display
                        break;
                    }
                }

                if (!realProjectId) {
                    console.log(`❌ Vui lòng cung cấp ID dự án hợp lệ. Dự án không tồn tại: ${projectId}`);
                    return;
                }

                let priorityLevel = 2; // Default Medium
                if (options.priority) {
                    if (typeof options.priority === 'string') {
                        switch (options.priority.toLowerCase()) {
                            case 'low': priorityLevel = 1; break;
                            case 'medium': priorityLevel = 2; break;
                            case 'high': priorityLevel = 3; break;
                            case 'urgent': priorityLevel = 4; break;
                            default:
                                const parsed = parseInt(options.priority, 10);
                                if (!isNaN(parsed) && parsed >= 0 && parsed <= 4) priorityLevel = parsed;
                        }
                    } else {
                        priorityLevel = parseInt(options.priority, 10);
                    }
                }

                let dueTimestamp: number | undefined;
                if (options.due) {
                    const now = new Date();
                    now.setHours(23, 59, 59, 999); // Due dates generally mean end of day
                    if (options.due.toLowerCase() === 'today') {
                        dueTimestamp = now.getTime();
                    } else if (options.due.toLowerCase() === 'tomorrow') {
                        now.setDate(now.getDate() + 1);
                        dueTimestamp = now.getTime();
                    } else {
                        const parsed = new Date(options.due);
                        if (!isNaN(parsed.getTime())) {
                            parsed.setHours(23, 59, 59, 999);
                            dueTimestamp = parsed.getTime();
                        }
                    }
                }

                let targetAssigneeId: string | undefined;
                let assigneeName = 'Chưa giao';

                if (options.assignee?.toLowerCase() === 'me') {
                    const account = await client.getAccount();
                    const personUuid = account.fullSocialIds?.[0]?.personUuid || account.uuid;

                    const persons = await client.getPersons();
                    const me = persons.find(p => p.personUuid === personUuid);
                    if (me) {
                        targetAssigneeId = me._id;
                        assigneeName = me.name || 'Bạn';
                    } else {
                        console.log('❌ Không thể xác minh được tài khoản của bạn (me) trên hệ thống.');
                        return;
                    }
                } else if (options.assignee) {
                    targetAssigneeId = options.assignee;
                    const persons = await client.getPersons();
                    const assignee = persons.find(p => p._id === options.assignee);
                    if (assignee) assigneeName = assignee.name || options.assignee;
                }

                const taskData = {
                    title: title,
                    projectId: realProjectId,
                    priority: priorityLevel,
                    dueDate: dueTimestamp,
                    assigneeId: targetAssigneeId
                };

                const createdTask = await client.createTask(taskData);

                let output = `✅ ĐÃ TẠO TASK MỚI\n\n`;
                output += `📋 ${createdTask.identifier}: ${createdTask.title}\n\n`;
                output += `🆔 Task ID: ${createdTask._id}\n`;
                output += `📁 Dự án: ${projectId}\n`;
                output += `🎯 Mức ưu tiên: ${PRIORITY_LABELS[createdTask.priority] || 'Trung bình'}\n`;
                output += `📅 Ngày hết hạn: ${dueTimestamp ? formatDate(dueTimestamp) : 'Không có'}\n`;
                output += `👤 Người thực hiện: ${assigneeName}\n`;
                output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Lỗi khi tạo task: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
