import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';

export function listTasksCommand() {
    return new Command('tasks')
        .description('List tasks with filters')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID or "me"')
        .option('-s, --status <statuses>', 'Filter by status names or IDs (comma separated)')
        .option('-p, --project <project>', 'Filter by project identifier (e.g., DELTA)')
        .option('--overdue', 'Show overdue tasks')
        .option('--due-today', 'Show tasks due today')
        .action(async (options) => {
            const client = new HulyClient();
            try {
                await client.connect();
                let targetAssigneeId: string | undefined;

                // Resolve "me"
                if (options.assignee?.toLowerCase() === 'me') {
                    const account = await client.getAccount();
                    const personUuid = account.fullSocialIds?.[0]?.personUuid || account.uuid;

                    const persons = await client.getPersons();
                    const me = persons.find(p => p.personUuid === personUuid);
                    if (me) {
                        targetAssigneeId = me._id;
                    } else {
                        console.log('❌ Không thể xác minh được tài khoản của bạn (me) trên hệ thống.');
                        return;
                    }
                } else if (options.assignee) {
                    targetAssigneeId = options.assignee; // Assume ID or find later
                }

                let targetProjectId: string | undefined;
                let projectMap = new Map<string, any>();
                const projects = await client.getProjects();
                for (const p of projects) {
                    projectMap.set(p._id, p);
                    if (options.project && (p.identifier === options.project || p.name === options.project || p._id === options.project)) {
                        targetProjectId = p._id;
                    }
                }

                if (options.project && !targetProjectId) {
                    console.log(`❌ Project ${options.project} not found.`);
                    return;
                }

                let targetStatusIds: string[] | undefined;
                let statusMap = new Map<string, any>();
                const statuses = await client.getStatuses();
                for (const s of statuses) {
                    statusMap.set(s._id, s);
                }

                if (options.status) {
                    const statusFilters = options.status.split(',').map((s: string) => s.trim().toLowerCase());
                    targetStatusIds = statuses
                        .filter(s => statusFilters.includes(s.name?.toLowerCase()) || statusFilters.includes(s._id))
                        .map(s => s._id);
                }

                const tasks = await client.queryTasks({
                    assignee: targetAssigneeId,
                    projectId: targetProjectId,
                    statusIds: targetStatusIds,
                    overdue: options.overdue,
                    dueToday: options.dueToday
                });

                // Filter out completed tasks if we only queried overdue/today but without explicit status
                const activeTasks = tasks.filter(task => {
                    if (options.status) return true; // caller specified status
                    const statusName = statusMap.get(task.status)?.name?.toLowerCase() || '';
                    const isDone = statusName.includes('done') || statusName.includes('closed') || statusName.includes('completed') || statusName.includes('resolved');
                    return !isDone;
                });

                activeTasks.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

                if (activeTasks.length === 0) {
                    printToConsole('✅ Không tìm thấy công việc nào phù hợp với bộ lọc!');
                    return;
                }

                // Output formatting
                let output = `📋 DANH SÁCH CÔNG VIỆC (${activeTasks.length})\n`;
                output += '━'.repeat(60) + '\n';

                for (const task of activeTasks) {
                    const project = projectMap.get(task.space);
                    const statusName = statusMap.get(task.status)?.name || 'Unknown';
                    const priorityLabel = PRIORITY_LABELS[task.priority] || 'NO';
                    const projectName = project?.name || project?.identifier || 'Unknown';
                    const dueStr = task.dueDate ? formatDate(task.dueDate) : 'N/A';

                    output += `📌 [${priorityLabel}] ${task.identifier}: ${task.title}\n`;
                    output += `   📁 Dự án: ${projectName} | 📊 Trạng thái: ${statusName}\n`;
                    output += `   📅 Hạn chót: ${dueStr}\n`;
                    output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                }

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Lỗi: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
