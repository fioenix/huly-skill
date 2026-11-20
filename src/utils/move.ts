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
