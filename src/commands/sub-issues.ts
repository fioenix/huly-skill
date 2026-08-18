import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, PRIORITY_LABELS, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, hulyError } from '../utils/errors.js';
import { getSubIssueTree, SubIssueNode } from '../services/sub-issues.js';

export function listSubIssuesCommand() {
    return new Command('sub-issues')
        .description('List sub-issues of a parent task as a tree (recursive by default)')
        .argument('<taskId>', 'Parent task identifier (e.g., LAMBD-568)')
        .option('--no-recursive', 'Only list direct children (one level deep)')
        .option('--flat', 'Output a flat list instead of a nested tree')
        .action(async (taskId, options) => {
            try {
                await withClient(async (client) => {
                    const result = await getSubIssueTree(client, taskId, options.recursive !== false);

                    if (isJsonMode()) {
                        const data = options.flat ? result.flat : result.data;
                        outputJson({
                            status: 'ok',
                            parent: result.parent,
                            totalCount: result.totalCount,
                            directChildren: result.directChildren,
                            data,
                        });
                        return;
                    }

                    if (result.totalCount === 0) {
                        printToConsole(`Task ${result.parent} khong co sub-issue nao.`);
                        return;
                    }

                    let output = `SUB-ISSUES cua ${result.parent} (${result.totalCount} tong, ${result.directChildren} direct)\n`;
                    output += '='.repeat(70) + '\n';
                    output += renderTree(result.data);
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });
}

function renderTree(nodes: SubIssueNode[], depth: number = 0): string {
    let out = '';
    for (const n of nodes) {
        const indent = '  '.repeat(depth);
        const priority = PRIORITY_LABELS[n.priority] || 'NO';
        const due = n.dueDate ? ` | due ${formatDate(n.dueDate)}` : '';
        const assignee = n.assignee ? ` | ${n.assignee}` : '';
        out += `${indent}- [${priority}] ${n.identifier}: ${n.title}\n`;
        out += `${indent}  status=${n.status}${assignee}${due} | est=${n.estimation} reported=${n.reportedTime}\n`;
        if (n.children.length > 0) out += renderTree(n.children, depth + 1);
    }
    return out;
}

/**
 * Look up a task by internal `_id` rather than identifier.
 * Useful when chasing references from `childInfo[].childId`.
 */
export function getTaskByIdCommand() {
    return new Command('task-by-id')
        .description('Get task details by internal _id (not the human identifier)')
        .argument('<internalId>', 'Internal task _id')
        .action(async (internalId) => {
            try {
                await withClient(async (client) => {
                    const task = await client.getTaskByInternalId(internalId);
                    if (!task) {
                        if (isJsonMode()) outputJson(errorPayload(hulyError('not_found', `Task not found: ${internalId}`)));
                        else console.error(`Khong tim thay task voi _id: ${internalId}`);
                        process.exitCode = 1;
                        return;
                    }
                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: task });
                        return;
                    }
                    printToConsole(`${task.identifier}: ${task.title}\n  _id: ${task._id}\n  space: ${task.space}`);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
