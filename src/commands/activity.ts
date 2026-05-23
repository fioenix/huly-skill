import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
import { getIssueActivity, ActivityEvent } from '../services/activity.js';

export function activityCommand() {
    return new Command('activity')
        .description('Show activity feed (changes + comments) for a task')
        .argument('<taskId>', 'Task identifier (e.g., LAMBD-568)')
        .option('--limit <n>', 'Max events per kind (updates + comments)', '200')
        .option('--updates-only', 'Hide comments, show only status/field changes')
        .option('--comments-only', 'Hide changes, show only comments')
        .action(async (taskId, options) => {
            try {
                await withClient(async (client) => {
                    const limit = parseInt(options.limit, 10) || 200;
                    const result = await getIssueActivity(client, taskId, limit);

                    let events = result.events;
                    if (options.updatesOnly) events = events.filter((e) => e.kind === 'update');
                    if (options.commentsOnly) events = events.filter((e) => e.kind === 'comment');

                    if (isJsonMode()) {
                        outputJson({
                            status: 'ok',
                            task: result.taskIdentifier,
                            count: events.length,
                            data: events,
                        });
                        return;
                    }

                    if (events.length === 0) {
                        printToConsole(`Task ${result.taskIdentifier} chua co activity nao.`);
                        return;
                    }

                    let output = `ACTIVITY: ${result.taskIdentifier} (${events.length} events)\n`;
                    output += '='.repeat(70) + '\n';
                    for (const e of events) output += renderEvent(e);
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });
}

function renderEvent(e: ActivityEvent): string {
    const when = formatDate(e.timestamp, true);
    const who = e.actor || e.actorId.slice(0, 8);
    if (e.kind === 'comment') {
        const body = (e.message || '(empty)').trim().replace(/\n/g, '\n   ');
        return `[${when}] ${who} commented:\n   ${body}\n\n`;
    }
    if (!e.changes || e.changes.length === 0) {
        return `[${when}] ${who} ${e.action || 'updated'} the issue\n`;
    }
    let line = `[${when}] ${who}:\n`;
    for (const c of e.changes) {
        if (c.added?.length || c.removed?.length) {
            const adds = c.added?.length ? ` +${c.added.join(',')}` : '';
            const rems = c.removed?.length ? ` -${c.removed.join(',')}` : '';
            line += `   ${c.attribute}:${adds}${rems}\n`;
        } else {
            line += `   ${c.attribute}: ${c.from ?? '∅'} → ${c.to ?? '∅'}\n`;
        }
    }
    return line + '\n';
}
