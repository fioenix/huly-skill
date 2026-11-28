/**
 * Checks for re-parenting an issue. Huly's own "Set parent" action writes only
 * `attachedTo` (and a `rank` at the end of the new parent's children); the
 * server trigger then rewrites `parents` on the issue and its descendants and
 * moves the issue between the old and new ancestors' `childInfo`.
 */
export interface MovableIssue {
    _id: string;
    identifier: string;
    space: string;
    attachedTo?: string;
    parents?: { parentId: string }[];
}

export type MovePlan =
    | { action: 'move'; attachedTo: string }
    | { action: 'noop'; reason: string };

export function planMove(issue: MovableIssue, newParent: MovableIssue | null, noParentId: string): MovePlan {
    if (newParent === null) {
        const current = issue.parents?.[0]?.parentId;
        if (!current) return { action: 'noop', reason: `${issue.identifier} already has no parent` };
        return { action: 'move', attachedTo: noParentId };
    }
    if (newParent._id === issue._id) {
        throw new Error(`${issue.identifier} cannot be its own parent`);
    }
    if (newParent.space !== issue.space) {
        throw new Error(`${newParent.identifier} belongs to another project; a sub-issue must live in the same project as its parent`);
    }
    if ((newParent.parents || []).some((p) => p.parentId === issue._id)) {
        throw new Error(`${newParent.identifier} is a descendant of ${issue.identifier}; moving would create a cycle`);
    }
    if (issue.attachedTo === newParent._id || issue.parents?.[0]?.parentId === newParent._id) {
        return { action: 'noop', reason: `${issue.identifier} is already under ${newParent.identifier}` };
    }
    return { action: 'move', attachedTo: newParent._id };
}

/** The part of Huly's ApplyOperations that a move needs. */
export interface MoveOps {
    match(_class: unknown, query: Record<string, unknown>): unknown;
    updateDoc(_class: unknown, space: string, objectId: string, operations: Record<string, unknown>): Promise<unknown>;
    commit(): Promise<{ result: boolean }>;
}

export interface MoveWrite {
    issueClass: unknown;
    task: { _id: string; identifier: string; space: string; attachedTo?: string };
    attachedTo: string;
    rank?: string;
    /** Parent the task leaves, if any; sub-issues share their parent's space. */
    oldParentId?: string | null;
    /** Parent the task joins, if any. */
    newParent?: { _id: string; space: string } | null;
}

/**
 * Write a move as one server transaction: the new `attachedTo` and both
 * parents' `subIssues` counters move together, by `$inc` rather than by an
 * absolute recount, and only while the task is still where it was read. A
 * dropped connection leaves either all of it or none of it; a concurrent move
 * of the same task makes the commit fail instead of double-counting.
 */
export async function applyMove(ops: MoveOps, write: MoveWrite): Promise<void> {
    const { issueClass, task } = write;
    ops.match(issueClass, { _id: task._id, attachedTo: task.attachedTo });
    await ops.updateDoc(issueClass, task.space, task._id,
        write.rank === undefined ? { attachedTo: write.attachedTo } : { attachedTo: write.attachedTo, rank: write.rank });
    if (write.oldParentId) {
        await ops.updateDoc(issueClass, task.space, write.oldParentId, { $inc: { subIssues: -1 } });
    }
    if (write.newParent) {
        await ops.updateDoc(issueClass, write.newParent.space, write.newParent._id, { $inc: { subIssues: 1 } });
    }
    const { result } = await ops.commit();
    if (!result) {
        throw new Error(`${task.identifier} changed while it was being moved, so nothing was written; read it again and retry`);
    }
}
