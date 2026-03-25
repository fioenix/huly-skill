import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, PRIORITY_LABELS, formatDate } from '../utils/logger.js';
import { resolveStatus, resolvePerson, parsePriority, parseDate } from '../resolvers.js';

export function updateTaskCommand() {
    return new Command('update')
        .arguments('task <taskId>')
        .description('Update a task by ID')
        .option('--status <statusName>', 'Set new status (e.g., Todo, In Progress, Done)')
        .option('--priority <priority>', 'Set priority (0-4 or LOW, MEDIUM, HIGH, URGENT)')
        .option('--due <dueDate>', 'Set due date (YYYY-MM-DD, "today", "tomorrow")')
        .option('-a, --assignee <assigneeId>', 'Set assignee (ID, name, or "me")')
        .option('--add-comment <comment>', 'Add a comment to the task')
        .option('--set-field <fields...>', 'Set custom field (key=value)')
        .action(async (type, taskId, options) => {
            const client = new HulyClient();
            try {
                await client.connect();

                const task = await client.getTask(taskId);
                if (!task) {
                    printToConsole(`❌ Khong tim thay cong viec: ${taskId}`);
                    return;
                }

                const updates: any = {};
                const changes: string[] = [];

                if (options.status) {
                    const resolved = await resolveStatus(client, options.status, task.space);
                    updates.statusId = resolved._id;
                    changes.push(`Trang thai → '${resolved.name}'`);
                }

                if (options.priority !== undefined) {
                    updates.priority = parsePriority(options.priority);
                    changes.push(`Uu tien → ${PRIORITY_LABELS[updates.priority] || updates.priority}`);
                }

                if (options.due) {
                    updates.dueDate = parseDate(options.due);
                    changes.push(`Han chot → ${updates.dueDate ? formatDate(updates.dueDate) : 'N/A'}`);
                }

                if (options.assignee) {
                    const person = await resolvePerson(client, options.assignee);
                    updates.assigneeId = person._id;
                    changes.push(`Nguoi thuc hien → ${person.name}`);
                }

                if (options.setField) {
                    for (const field of options.setField) {
                        const eqIdx = field.indexOf('=');
                        if (eqIdx === -1) {
                            printToConsole(`⚠️ Custom field phai co dang key=value: '${field}'`);
                            continue;
                        }
                        const key = field.slice(0, eqIdx);
                        const value = field.slice(eqIdx + 1);
                        updates[key] = value;
                        changes.push(`${key} → ${value}`);
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await client.updateTask(taskId, updates);
                }

                if (options.addComment) {
                    await client.addComment(taskId, options.addComment);
                    changes.push(`Binh luan da them`);
                }

                if (changes.length === 0) {
                    printToConsole(`ℹ️ Khong co thong tin gi de cap nhat cho ${taskId}`);
                } else {
                    let output = `✅ Cap nhat hoan tat cho ${taskId}:\n`;
                    for (const c of changes) output += `  • ${c}\n`;
                    printToConsole(output);
                }

            } catch (e: any) {
                console.error(`❌ Loi cap nhat task: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
