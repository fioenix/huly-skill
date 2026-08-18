import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, PRIORITY_LABELS, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload } from '../utils/errors.js';
import { reportIssues } from '../services/issues.js';

export function reportCommand() {
    return new Command('report')
        .arguments('<type>')
        .description('Generate daily or weekly task report')
        .option('-a, --assignee <assignee>', 'Filter by assignee ID, name, or "me"', 'me')
        .action(async (type, options) => {
            const normalized = type.toLowerCase();
            if (normalized !== 'daily' && normalized !== 'weekly') {
                console.error(`❌ Loai bao cao khong hop le. Vui long chon 'daily' hoac 'weekly'.`);
                process.exitCode = 1;
                return;
            }

            try {
                await withClient(async (client) => {
                    const report = await reportIssues(client, {
                        type: normalized as 'daily' | 'weekly',
                        assignee: options.assignee,
                    });

                    if (isJsonMode()) {
                        outputJson({
                            status: 'ok',
                            type: report.type,
                            assignee: report.assigneeName,
                            due: report.due,
                            overdue: report.overdue,
                            inProgress: report.inProgress,
                        });
                        return;
                    }

                    const isDaily = report.type === 'daily';
                    const todayTime = new Date().setHours(0, 0, 0, 0);

                    let output = `📋 TASKS DUE ${isDaily ? 'TODAY' : 'THIS WEEK'} - ${new Date().toLocaleDateString('vi-VN')}\n\n`;

                    output += `⏰ Due ${isDaily ? 'Today' : 'This Week'} (${report.due.length})\n`;
                    for (const task of report.due) {
                        output += `• [${PRIORITY_LABELS[task.priority] || 'MED'}] ${task.title} — @${report.assigneeName} — Project: ${report.projectMap.get(task.space)?.name || 'Unknown'}\n`;
                    }

                    if (report.overdue.length > 0) {
                        output += `\n🚨 Overdue (${report.overdue.length})\n`;
                        for (const task of report.overdue) {
                            const daysLate = Math.floor((todayTime - new Date(task.dueDate).getTime()) / (1000 * 60 * 60 * 24));
                            output += `• [${PRIORITY_LABELS[task.priority] || 'MED'}] ${task.title} — @${report.assigneeName} (${daysLate} days late)\n`;
                        }
                    }

                    output += `\n📊 Summary: ${report.due.length} due ${isDaily ? 'today' : 'this week'} | ${report.overdue.length} overdue | ${report.inProgress} in progress`;

                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`❌ Loi tao bao cao: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
