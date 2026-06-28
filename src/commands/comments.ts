import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
import { listComments, getCommentById, CommentItem } from '../services/comments.js';

export function commentsCommand() {
    const cmd = new Command('comments')
        .description('Read comments attached to any Huly object (issue, milestone, document, ...)');

    cmd.command('list')
        .description('List comments on an object by its internal _id')
        .argument('<targetId>', 'Internal _id of the parent object (e.g. a milestone _id)')
        .option('--class <ref>', 'Parent class filter: alias (issue|milestone|component|project|document) or raw ref')
        .option('--limit <n>', 'Max comments', '200')
        .action(async (targetId, options) => {
            try {
                await withClient(async (client) => {
                    const limit = parseInt(options.limit, 10) || 200;
                    const comments = await listComments(client, targetId, options.class, limit);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', count: comments.length, data: comments });
                        return;
                    }
                    if (comments.length === 0) {
                        printToConsole(`Object ${targetId} chua co comment nao.`);
                        return;
                    }
                    let output = `COMMENTS: ${targetId} (${comments.length})\n` + '='.repeat(70) + '\n';
                    for (const c of comments) output += renderComment(c);
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });

    cmd.command('get')
        .description('Get a single comment by its ChatMessage _id (the "message" link param)')
        .argument('<messageId>', 'ChatMessage _id')
        .action(async (messageId) => {
            try {
                await withClient(async (client) => {
                    const comment = await getCommentById(client, messageId);
                    if (isJsonMode()) {
                        outputJson(comment
                            ? { status: 'ok', data: comment }
                            : { status: 'error', error: `Khong tim thay comment: ${messageId}` });
                        return;
                    }
                    if (!comment) {
                        printToConsole(`Khong tim thay comment: ${messageId}`);
                        return;
                    }
                    printToConsole(renderComment(comment));
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });

    return cmd;
}

function renderComment(c: CommentItem, depth: number = 0): string {
    const pad = '   '.repeat(depth);
    const when = formatDate(c.timestamp, true);
    const who = c.actor || c.actorId.slice(0, 8);
    const edited = c.editedOn ? ' (edited)' : '';
    const body = (c.message || '(empty)').trim().replace(/\n/g, `\n${pad}   `);
    let out = `${pad}[${when}] ${who}${edited}:\n${pad}   ${body}\n\n`;
    for (const r of c.replies ?? []) out += renderComment(r, depth + 1);
    return out;
}
