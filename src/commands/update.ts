import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { parseRawFields, safeReadFile } from '../resolvers.js';
import { updateIssue } from '../services/issues.js';

export function updateTaskCommand() {
    return new Command('update')
        .arguments('task <taskId>')
        .description('Update a task by ID')
        .option('--status <statusName>', 'Set new status (e.g., Todo, In Progress, Done)')
        .option('--priority <priority>', 'Set priority (0-4 or LOW, MEDIUM, HIGH, URGENT)')
        .option('--due <dueDate>', 'Set due date (YYYY-MM-DD, "today", "tomorrow")')
        .option('-a, --assignee <assigneeId>', 'Set assignee (ID, name, or "me")')
        .option('--kind-id <kindId>', 'Set task type / kind ID')
        .option('--component-id <componentId>', 'Set component ID')
        .option('--milestone-id <milestoneId>', 'Set milestone ID')
        .option('--set-field <fields...>', 'Set custom field (key=value, supports null/true/false/number)')
        .option('--description-file <path>', 'Set description from a markdown file')
        .option('--add-comment <comment>', 'Add a comment to the task')
        .action(async (type, taskId, options) => {
            try {
                await withClient(async (client) => {
                    const changes = await updateIssue(client, taskId, {
                        status: options.status,
                        priority: options.priority,
                        due: options.due,
                        assignee: options.assignee,
                        kindId: options.kindId,
                        componentId: options.componentId,
                        milestoneId: options.milestoneId,
                        rawFields: options.setField ? parseRawFields(options.setField) : undefined,
                        descriptionMarkdown: options.descriptionFile ? safeReadFile(options.descriptionFile) : undefined,
                        comment: options.addComment,
                    });

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', taskId, changes });
                    } else if (changes.length === 0) {
                        printToConsole(`ℹ️ Khong co thong tin gi de cap nhat cho ${taskId}`);
                    } else {
                        let output = `✅ Cap nhat hoan tat cho ${taskId}:\n`;
                        for (const c of changes) output += `  • ${c}\n`;
                        printToConsole(output);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`❌ Loi cap nhat task: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
