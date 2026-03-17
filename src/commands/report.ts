import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS } from '../utils/logger.js';

export function reportCommand() {
    return new Command('report')
        .arguments('<type>')
        .description('Generate daily or weekly task report')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID or "me"', 'me')
        .action(async (type, options) => {
            const isDaily = type.toLowerCase() === 'daily';
            const isWeekly = type.toLowerCase() === 'weekly';

            if (!isDaily && !isWeekly) {
                console.log(`❌ Loại báo cáo không hợp lệ. Vui lòng chọn 'daily' hoặc 'weekly'.`);
                return;
            }

            const client = new HulyClient();
            try {
                await client.connect();

                let targetAssigneeId: string | undefined;
                let assigneeName = 'Bạn';

                if (options.assignee?.toLowerCase() === 'me') {
                    const account = await client.getAccount();
                    const personUuid = account.fullSocialIds?.[0]?.personUuid || account.uuid;

                    const persons = await client.getPersons();
                    const me = persons.find(p => p.personUuid === personUuid);
                    if (me) {
                        targetAssigneeId = me._id;
                        assigneeName = me.name || 'Bạn';
                    } else {
                        console.log('❌ Không thể xác minh được tài khoản của bạn (me) trên hệ thống.');
                        return;
                    }
                } else if (options.assignee) {
                    targetAssigneeId = options.assignee;
                    const persons = await client.getPersons();
                    const assignee = persons.find(p => p._id === options.assignee);
                    if (assignee) assigneeName = assignee.name || options.assignee;
                }

                const tasks = await client.queryTasks({
                    assignee: targetAssigneeId
                });

                const projects = await client.getProjects();
                const projectMap = new Map();
                for (const p of projects) projectMap.set(p._id, p);

                let statuses = await client.getStatuses();
                let statusMap = new Map();
                for (const s of statuses) statusMap.set(s._id, s);

                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const todayTime = now.getTime();

                const endOfWeek = new Date();
                endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
                endOfWeek.setHours(23, 59, 59, 999);
                const endOfWeekTime = endOfWeek.getTime();

                const overdue: any[] = [];
                const dueTarget: any[] = []; // Today for daily, this week for weekly
                const inProgress: number = tasks.filter(task => { // just counting
                    const s = statusMap.get(task.status)?.name?.toLowerCase() || '';
                    return s.includes('progress') || s.includes('doing');
                }).length;

                for (const task of tasks) {
                    const statusName = statusMap.get(task.status)?.name?.toLowerCase() || '';
                    if (statusName.includes('done') || statusName.includes('resolved') || statusName.includes('closed') || statusName.includes('completed')) {
                        continue; // Skip finished
                    }

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
                console.error(`❌ Lỗi tạo báo cáo: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
