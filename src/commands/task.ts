import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS, isJsonMode, outputJson } from '../utils/logger.js';
import { EXIT_STATUS, errorPayload, exitStatusFor, hulyError } from '../utils/errors.js';
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
                        if (isJsonMode()) outputJson(errorPayload(hulyError('not_found', `Task not found: ${taskId}`)));
                        else console.error(`❌ Task not found: ${taskId}`);
                        process.exitCode = EXIT_STATUS.not_found;
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

                    let assigneeName = 'Unassigned';
                    if (task.assignee) {
                        const persons = await client.getPersons();
                        const assignee = persons.find((p: any) => p._id === task.assignee);
                        if (assignee) {
                            assigneeName = assignee.name || assignee.displayName || task.assignee;
                        }
                    }

                    let output = `📋 TASK: ${task.identifier}\n\n`;
                    output += `📌 Title: ${task.title || 'N/A'}\n`;
                    output += `📁 Project: ${project?.identifier || 'Unknown'} - ${project?.name || 'Unknown'}\n`;
                    output += `📊 Status: ${status?.name || 'Unknown'}\n`;
                    output += `🎯 Priority: ${PRIORITY_LABELS[task.priority] || 'NONE'}\n`;
                    output += `👤 Assignee: ${assigneeName}\n\n`;

                    output += `📅 Created: ${formatDate(task.createdOn, true)}\n`;
                    output += `📅 Updated: ${formatDate(task.modifiedOn, true)}\n`;
                    output += `⏰ Due: ${task.dueDate ? formatDate(task.dueDate) : 'N/A'}\n\n`;

                    if (task.description) {
                        try {
                            const descContent = await client.fetchMarkup(task, 'description');
                            if (descContent) output += `📝 Description:\n${descContent}\n`;
                            else output += `📝 Description: (could not be read)\n`;
                        } catch {
                            output += `📝 Description: (could not be read)\n`;
                        }
                    }

                    if (task.labels && task.labels.length > 0) {
                        output += `🏷️ Nhan: ${task.labels.join(', ')}\n`;
                    }

                    if (task.attachments && task.attachments > 0) {
                        output += `📎 Attachments: ${task.attachments}\n`;
                    }

                    if (task.comments && task.comments > 0) {
                        output += `💬 Comments: ${task.comments}\n`;
                    }

                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`❌ Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
