import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, PRIORITY_LABELS } from '../utils/logger.js';
import { resolvePerson, getProjectMap, getStatusMap } from '../resolvers.js';
import { isCompletedStatus } from '../services/issues.js';

export function reportCommand() {
    return new Command('report')
        .arguments('<type>')
        .description('Generate daily or weekly task report')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID, name, or "me"', 'me')
        .action(async (type, options) => {
            const isDaily = type.toLowerCase() === 'daily';
            const isWeekly = type.toLowerCase() === 'weekly';

            if (!isDaily && !isWeekly) {
                console.log(`❌ Loai bao cao khong hop le. Vui long chon 'daily' hoac 'weekly'.`);
                return;
            }

            const client = new HulyClient();
            try {
                await client.connect();

                let assigneeId: string | undefined;
                let assigneeName = 'Ban';

                if (options.assignee) {
                    const person = await resolvePerson(client, options.assignee);
                    assigneeId = person._id;
                    assigneeName = person.name;
                }

                const tasks = await client.queryTasks({ assignee: assigneeId });
                const projectMap = await getProjectMap(client);
                const statusMap = await getStatusMap(client);

                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const todayTime = now.getTime();

                const endOfWeek = new Date();
                endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
                endOfWeek.setHours(23, 59, 59, 999);
                const endOfWeekTime = endOfWeek.getTime();

                const overdue: any[] = [];
                const dueTarget: any[] = [];
                const inProgress = tasks.filter((task: any) => {
                    const s = statusMap.get(task.status)?.name?.toLowerCase() || '';
                    return s.includes('progress') || s.includes('doing');
                }).length;

                for (const task of tasks) {
                    const statusName = statusMap.get(task.status)?.name || '';
                    if (isCompletedStatus(statusName)) continue;
                    if (!task.dueDate) continue;

                    const due = new Date(task.dueDate);
                    due.setHours(0, 0, 0, 0);
                    const dueTime = due.getTime();

                    if (dueTime < todayTime) {
                        overdue.push(task);
                    } else if (isDaily && dueTime === todayTime) {
                        dueTarget.push(task);
                    } else if (isWeekly && dueTime >= todayTime && dueTime <= endOfWeekTime) {
                        dueTarget.push(task);
                    }
                }

                dueTarget.sort((a, b) => (b.priority || 0) - (a.priority || 0));
                overdue.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

                let output = `📋 TASKS DUE ${isDaily ? 'TODAY' : 'THIS WEEK'} - ${now.toLocaleDateString('vi-VN')}\n\n`;

                output += `⏰ Due ${isDaily ? 'Today' : 'This Week'} (${dueTarget.length})\n`;
                for (const task of dueTarget) {
                    output += `• [${PRIORITY_LABELS[task.priority] || 'MED'}] ${task.title} — @${assigneeName} — Project: ${projectMap.get(task.space)?.name || 'Unknown'}\n`;
                }

                if (overdue.length > 0) {
                    output += `\n🚨 Overdue (${overdue.length})\n`;
                    for (const task of overdue) {
                        const daysLate = Math.floor((todayTime - new Date(task.dueDate).getTime()) / (1000 * 60 * 60 * 24));
                        output += `• [${PRIORITY_LABELS[task.priority] || 'MED'}] ${task.title} — @${assigneeName} (${daysLate} days late)\n`;
                    }
                }

                output += `\n📊 Summary: ${dueTarget.length} due ${isDaily ? 'today' : 'this week'} | ${overdue.length} overdue | ${inProgress} in progress`;

                printToConsole(output);

            } catch (e: any) {
                console.error(`❌ Loi tao bao cao: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
