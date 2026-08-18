import { HulyClient } from '../client.js';
import { buildSocialIdMap } from './activity.js';

export interface CommentItem {
    id: string;
    attachedTo: string | null;
    attachedToClass: string | null;
    timestamp: number;
    createdOn: number | null;
    /** Set by Huly when the author later edits the comment; null otherwise. */
    editedOn: number | null;
    actor: string | null;
    actorId: string;
    /** Comment body resolved to markdown. */
    message: string | null;
    /** Thread replies nested under this comment (ThreadMessage), oldest-first. */
    replies?: CommentItem[];
}

/**
 * Friendly aliases → Huly class refs for the `attachedToClass` filter.
 * Callers may also pass a raw ref (e.g. "tracker:class:Milestone") directly.
 */
export const COMMENT_TARGET_CLASSES: Record<string, string> = {
    issue: 'tracker:class:Issue',
    milestone: 'tracker:class:Milestone',
    component: 'tracker:class:Component',
    project: 'tracker:class:Project',
    document: 'document:class:Document',
};

export function resolveTargetClass(target?: string): string | undefined {
    if (!target) return undefined;
    return COMMENT_TARGET_CLASSES[target] ?? target;
}

async function toItem(
    client: HulyClient,
    c: any,
    socialIdToName: Map<string, string>,
): Promise<CommentItem> {
    const message = client.renderMarkup(c.message);
    return {
        id: c._id,
        attachedTo: c.attachedTo ?? null,
        attachedToClass: c.attachedToClass ?? null,
        timestamp: c.modifiedOn,
        createdOn: c.createdOn ?? null,
        editedOn: c.editedOn ?? null,
        actor: socialIdToName.get(c.modifiedBy) ?? null,
        actorId: c.modifiedBy,
        message,
    };
}

/**
 * List comments attached to any object (issue, milestone, document, ...).
 * `attachedToClass` is optional; pass a friendly alias or a raw class ref.
 */
export async function listComments(
    client: HulyClient,
    attachedTo: string,
    attachedToClass?: string,
    limit: number = 200,
): Promise<CommentItem[]> {
    const [comments, replies, persons, socialIds] = await Promise.all([
        client.getComments(attachedTo, resolveTargetClass(attachedToClass), limit),
        client.getThreadReplies({ objectId: attachedTo }, limit),
        client.getPersons(),
        client.getSocialIdentities(),
    ]);
    const socialIdToName = buildSocialIdMap(persons, socialIds);
    const topItems = await Promise.all(comments.map((c) => toItem(client, c, socialIdToName)));
    const replyItems = await Promise.all(replies.map((r) => toItem(client, r, socialIdToName)));

    // Nest each reply under its parent comment (reply.attachedTo === parent _id).
    const byParent = new Map<string, CommentItem[]>();
    for (const r of replyItems) {
        const key = r.attachedTo ?? '';
        (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(r);
    }
    for (const t of topItems) {
        const kids = byParent.get(t.id);
        if (kids?.length) t.replies = kids;
    }
    // Replies whose parent falls outside this page stay out: the result must hold
    // at most `limit` top-level comments, and a detached reply loses its context.
    return topItems;
}

/** Resolve a single comment by its ChatMessage _id (the `message` link param). */
export async function getCommentById(
    client: HulyClient,
    messageId: string,
): Promise<CommentItem | null> {
    const [comment, persons, socialIds] = await Promise.all([
        client.getCommentById(messageId),
        client.getPersons(),
        client.getSocialIdentities(),
    ]);
    if (!comment) return null;
    const socialIdToName = buildSocialIdMap(persons, socialIds);
    const item = await toItem(client, comment, socialIdToName);

    const replies = await client.getThreadReplies({ attachedTo: messageId }, 200);
    if (replies.length) {
        item.replies = await Promise.all(replies.map((r) => toItem(client, r, socialIdToName)));
    }
    return item;
}

/**
 * Edit a comment and return it as it now stands, so a caller sees the stored
 * result rather than the text it hoped was stored.
 */
export async function updateComment(
    client: HulyClient,
    messageId: string,
    message: string,
): Promise<CommentItem> {
    await client.updateComment(messageId, message);
    const updated = await getCommentById(client, messageId);
    if (!updated) throw new Error(`Comment not found after the update: ${messageId}`);
    return updated;
}

/** Delete a comment, returning what was deleted for the caller to report. */
export async function deleteComment(client: HulyClient, messageId: string): Promise<CommentItem> {
    const existing = await getCommentById(client, messageId);
    if (!existing) throw new Error(`Comment not found: ${messageId}`);
    await client.deleteComment(messageId);
    return existing;
}
