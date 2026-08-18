import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor } from '../utils/errors.js';
import { queryIssues, isCompletedStatus } from '../services/issues.js';
import { parseFields, projectRows } from '../utils/projection.js';

export function listTasksCommand() {
    return new Command('tasks')
        .description('List tasks with filters')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID, name, or "me"')
        .option('-s, --status <statuses>', 'Filter by status names or IDs (comma separated)')
        .option('-p, --project <project>', 'Filter by project identifier (e.g., DELTA)')
        .option('--overdue', 'Show overdue tasks')
        .option('--due-today', 'Show tasks due today')
        .option('--parent <parent>', 'Filter by parent task identifier (e.g., LAMBD-568) or internal _id — direct children only')
        .option('--milestone-id <id>', 'Filter by milestone internal _id')
        .option('--limit <n>', 'Return at most n tasks (no cap by default)', (v) => parseInt(v, 10))
        .option('--fields <list>', 'JSON only: comma-separated fields to keep, or "all" for whole documents (default: all)')
        .action(async (options) => {
            try {
                await withClient(async (client) => {
                    const { tasks, projectMap, statusMap } = await queryIssues(client, {
                        assignee: options.assignee,
                        project: options.project,
                        status: options.status,
                        overdue: options.overdue,
                        dueToday: options.dueToday,
                        parent: options.parent,
                        milestoneId: options.milestoneId,
                    });

                    const activeTasks = tasks.filter(task => {
                        if (options.status) return true;
                        const statusName = statusMap.get(task.status)?.name || '';
                        return !isCompletedStatus(statusName);
                    });

                    activeTasks.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

                    // The CLI feeds shell pipelines, so it stays uncapped and
                    // unprojected unless asked — only the MCP adapter, whose output
                    // lands in an agent's context, defaults to trimming.
                    const limit = options.limit;
                    const shown = limit > 0 ? activeTasks.slice(0, limit) : activeTasks;
                    const truncated = shown.length < activeTasks.length;

                    if (isJsonMode()) {
                        outputJson({
                            status: 'ok',
                            count: shown.length,
                            total: activeTasks.length,
                            truncated,
                            data: projectRows(shown, parseFields(options.fields ?? 'all', 'task')),
                        });
                        return;
                    }

                    if (activeTasks.length === 0) {
                        printToConsole('✅ No tasks match these filters.');
                        return;
                    }

                    let output = truncated
                        ? `📋 TASKS (${shown.length}/${activeTasks.length} — capped by --limit)\n`
                        : `📋 TASKS (${activeTasks.length})\n`;
                    output += '━'.repeat(60) + '\n';

                    for (const task of shown) {
                        const project = projectMap.get(task.space);
                        const statusName = statusMap.get(task.status)?.name || 'Unknown';
                        const priorityLabel = PRIORITY_LABELS[task.priority] || 'NO';
                        const projectName = project?.name || project?.identifier || 'Unknown';
                        const dueStr = task.dueDate ? formatDate(task.dueDate) : 'N/A';

                        output += `📌 [${priorityLabel}] ${task.identifier}: ${task.title}\n`;
                        output += `   📁 Project: ${projectName} | 📊 Status: ${statusName}\n`;
                        output += `   📅 Due: ${dueStr}\n`;
                        output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
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
