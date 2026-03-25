import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';

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
                        printToConsole('Khong co label nao trong workspace.');
                        return;
                    }

                    let output = `DANH SACH LABELS (${labels.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const label of labels) {
                        output += `  [${label.color}] ${label.title}\n`;
                        output += `    ID: ${label._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
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
                        printToConsole(`Da tao label: "${label.title}" (ID: ${label._id})`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi khi tao label: ${e.message}`);
                process.exitCode = 1;
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
                        console.error(`Khong tim thay task: ${taskId}`);
                        process.exitCode = 1;
                        return;
                    }

                    const displayTitle = options.title || labelId;
                    await client.assignLabel(task._id, task.space, labelId, displayTitle, parseInt(options.color, 10));

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', taskId, labelId });
                    } else {
                        printToConsole(`Da gan label "${displayTitle}" vao task ${taskId}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
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
                        console.error(`Khong tim thay task: ${taskId}`);
                        process.exitCode = 1;
                        return;
                    }

                    const labels = await client.getLabels(task._id);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', taskId, count: labels.length, data: labels });
                        return;
                    }

                    if (labels.length === 0) {
                        printToConsole(`Task ${taskId} khong co label nao.`);
                        return;
                    }

                    let output = `Labels cua ${taskId} (${labels.length}):\n`;
                    for (const label of labels) {
                        output += `  - ${label.title}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });

    return cmd;
}
