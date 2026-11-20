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

    for (const ref of refs) {
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
