import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';
import { queryIssues, isCompletedStatus } from '../services/issues.js';

export function listTasksCommand() {
    return new Command('tasks')
        .description('List tasks with filters')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID, name, or "me"')
        .option('-s, --status <statuses>', 'Filter by status names or IDs (comma separated)')
        .option('-p, --project <project>', 'Filter by project identifier (e.g., DELTA)')
        .option('--overdue', 'Show overdue tasks')
        .option('--due-today', 'Show tasks due today')
        .action(async (options) => {
            const client = new HulyClient();
            try {
                await client.connect();

                const { tasks, projectMap, statusMap } = await queryIssues(client, {
                    assignee: options.assignee,
                    project: options.project,
                    status: options.status,
                    overdue: options.overdue,
                    dueToday: options.dueToday,
                });

                // Filter out completed tasks unless caller specified status explicitly
                const activeTasks = tasks.filter(task => {
                    if (options.status) return true;
                    const statusName = statusMap.get(task.status)?.name || '';
                    return !isCompletedStatus(statusName);
                });

                activeTasks.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

                if (activeTasks.length === 0) {
                    printToConsole('✅ Khong tim thay cong viec nao phu hop voi bo loc!');
                    return;
                }

                let output = `📋 DANH SACH CONG VIEC (${activeTasks.length})\n`;
                output += '━'.repeat(60) + '\n';

                for (const task of activeTasks) {
                    const project = projectMap.get(task.space);
                    const statusName = statusMap.get(task.status)?.name || 'Unknown';
                    const priorityLabel = PRIORITY_LABELS[task.priority] || 'NO';
                    const projectName = project?.name || project?.identifier || 'Unknown';
                    const dueStr = task.dueDate ? formatDate(task.dueDate) : 'N/A';

                    output += `📌 [${priorityLabel}] ${task.identifier}: ${task.title}\n`;
                    output += `   📁 Du an: ${projectName} | 📊 Trang thai: ${statusName}\n`;
                    output += `   📅 Han chot: ${dueStr}\n`;
                    output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                }

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Loi: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
