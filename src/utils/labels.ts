export interface LabelElement {
    _id: string;
    title: string;
    color?: number;
}

export interface LabelReference {
    _id: string;
    tag: string;
    title?: string;
    color?: number;
    createdOn?: number;
}

export interface LabelRepairPlan {
    updates: { refId: string; title: string; color: number }[];
    removals: string[];
}

// Huly renders a label pill from the reference's own title and color, not from
// the label it points at, so a reference must carry a copy of both.
export function labelDisplay(element: LabelElement, title?: string, color?: number): { title: string; color: number } {
    return {
        title: title || element.title,
        color: color ?? element.color ?? 11,
    };
}

export function planLabelRepair(refs: LabelReference[], elements: LabelElement[]): LabelRepairPlan {
    const byId = new Map(elements.map((e) => [e._id, e]));
    const seen = new Set<string>();
    const plan: LabelRepairPlan = { updates: [], removals: [] };

    for (const ref of [...refs].sort(byAge)) {
        if (seen.has(ref.tag)) {
            plan.removals.push(ref._id);
            continue;
        }
        seen.add(ref.tag);

        const element = byId.get(ref.tag);
        if (!element) continue;
        const want = labelDisplay(element);
        if (ref.title !== want.title || ref.color !== want.color) {
            plan.updates.push({ refId: ref._id, ...want });
        }
    }
    return plan;
}

/** Oldest first; `_id` breaks ties so every caller picks the same survivor. */
function byAge(a: LabelReference, b: LabelReference): number {
    return (a.createdOn ?? 0) - (b.createdOn ?? 0) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
}

/**
 * References to `tag` that must go so exactly one remains. The survivor is the
 * oldest, so two writers racing on the same task converge on the same one.
 */
export function duplicateRefs(refs: LabelReference[], tag: string): string[] {
    return refs.filter((r) => r.tag === tag).sort(byAge).slice(1).map((r) => r._id);
}

/**
 * After an assign, which references to remove so exactly one remains, and
 * whether the label was already there. Runs whether or not this call inserted,
 * so a retry after a cleanup that never finished still converges.
 */
export function planAssign(refsAfter: LabelReference[], tag: string, insertedRefId: string | null): { alreadyAssigned: boolean; remove: string[] } {
    const remove = duplicateRefs(refsAfter, tag);
    return { alreadyAssigned: insertedRefId === null || remove.includes(insertedRefId), remove };
}

/** Pair each requested task id with its task, and list the ids that resolved to nothing. */
export function planRepairTargets<T>(taskIds: string[], tasks: (T | null | undefined)[]): { targets: { taskId: string; task: T }[]; missing: string[] } {
    const targets: { taskId: string; task: T }[] = [];
    const missing: string[] = [];
    taskIds.forEach((taskId, i) => {
        const task = tasks[i];
        if (task) targets.push({ taskId, task });
        else missing.push(taskId);
    });
    return { targets, missing };
}
