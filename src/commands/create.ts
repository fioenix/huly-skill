import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';
import { createIssue } from '../services/issues.js';

export function createTaskCommand() {
    return new Command('create')
        .arguments('task <title>')
        .description('Create a new task')
        .option('-p, --project <projectId>', 'Project identifier (e.g., DELTA, required)')
        .option('--priority <priority>', 'Priority level (0-4 or LOW, MEDIUM, HIGH, URGENT)', '2')
        .option('--due <dueDate>', 'Due date (YYYY-MM-DD or "today", "tomorrow")')
        .option('-a, --assignee <assigneeId>', 'Assignee ID, name, or "me"')
        .option('--set-field <fields...>', 'Set custom field (key=value)')
        .action(async (type, title, options) => {
            const client = new HulyClient();
            try {
                await client.connect();

                if (!options.project) {
                    console.log('❌ Phai co co --project (VD: --project DELTA)');
                    return;
                }

                const customFields: Record<string, string> = {};
                if (options.setField) {
                    for (const field of options.setField) {
                        const eqIdx = field.indexOf('=');
                        if (eqIdx !== -1) {
                            customFields[field.slice(0, eqIdx)] = field.slice(eqIdx + 1);
                        }
                    }
                }

                const result = await createIssue(client, {
                    title,
                    project: options.project,
                    priority: options.priority,
                    due: options.due,
                    assignee: options.assignee,
                    customFields,
                });

                const task = result.task;
                let output = `✅ DA TAO TASK MOI\n\n`;
                output += `📋 ${task.identifier}: ${task.title}\n\n`;
                output += `🆔 Task ID: ${task._id}\n`;
                output += `📁 Du an: ${result.projectIdentifier}\n`;
                output += `🎯 Muc uu tien: ${PRIORITY_LABELS[task.priority] || 'Trung binh'}\n`;
                output += `📅 Ngay het han: ${task.dueDate ? formatDate(task.dueDate) : 'Khong co'}\n`;
                output += `👤 Nguoi thuc hien: ${result.assigneeName}\n`;
                output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Loi khi tao task: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
