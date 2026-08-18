import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor, hulyError } from '../utils/errors.js';

export function labelsCommand() {
    const cmd = new Command('labels')
        .description('Manage issue labels/tags');

    cmd.command('list')
        .description('List all available labels')
        .action(async () => {
            try {
                await withClient(async (client) => {
                    const labels = await client.getAllLabels();

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', count: labels.length, data: labels });
                        return;
                    }

                    if (labels.length === 0) {
                        printToConsole('No labels in this workspace.');
                        return;
                    }

                    let output = `LABELS (${labels.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const label of labels) {
                        output += `  [${label.color}] ${label.title}\n`;
                        output += `    ID: ${label._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('create')
        .description('Create a new label')
        .argument('<title>', 'Label title')
        .option('--color <color>', 'Color index (0-15)', '11')
        .action(async (title, options) => {
            try {
                await withClient(async (client) => {
                    const label = await client.createLabel(title, parseInt(options.color, 10));

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: label });
                    } else {
                        printToConsole(`Created label: "${label.title}" (ID: ${label._id})`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not create the label: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('assign')
        .description('Assign a label to an issue')
        .argument('<taskId>', 'Task identifier (e.g., DELTA-123)')
        .argument('<labelId>', 'Label ID to assign')
        .option('--title <title>', 'Display title for the reference', '')
        .option('--color <color>', 'Color index (0-15)', '11')
        .action(async (taskId, labelId, options) => {
            try {
                await withClient(async (client) => {
                    const task = await client.getTask(taskId);
                    if (!task) {
                        const e = hulyError('not_found', `Task not found: ${taskId}`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    const displayTitle = options.title || labelId;
                    await client.assignLabel(task._id, task.space, labelId, displayTitle, parseInt(options.color, 10));

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', taskId, labelId });
                    } else {
                        printToConsole(`Assigned label "${displayTitle}" to task ${taskId}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('show')
        .description('Show labels assigned to an issue')
        .argument('<taskId>', 'Task identifier (e.g., DELTA-123)')
        .action(async (taskId) => {
            try {
                await withClient(async (client) => {
                    const task = await client.getTask(taskId);
                    if (!task) {
                        const e = hulyError('not_found', `Task not found: ${taskId}`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    const labels = await client.getLabels(task._id);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', taskId, count: labels.length, data: labels });
                        return;
                    }

                    if (labels.length === 0) {
                        printToConsole(`Task ${taskId} has no labels.`);
                        return;
                    }

                    let output = `Labels on ${taskId} (${labels.length}):\n`;
                    for (const label of labels) {
                        output += `  - ${label.title}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    return cmd;
}
