// Output shaping for list results. Huly documents carry ~30 fields, most of them
// storage bookkeeping (rank, childInfo, docUpdateMessages, attachedToClass, …).
// Returning them whole is what makes a single list call cost more context than an
// entire tool catalogue, so lists project down to the fields callers actually read
// and cap how many rows come back. `fields: 'all'` restores the raw documents.

export const DEFAULT_LIST_LIMIT = 50;

/** Field sets kept for list results, per entity. `_id` stays because comment and
 * label tools address objects by internal id. */
export const LIST_FIELDS = {
    task: [
        '_id', 'identifier', 'title', 'status', 'statusName', 'priority',
        'assignee', 'dueDate', 'projectName', 'milestone', 'component',
        'subIssues', 'modifiedOn',
    ],
    project: ['_id', 'identifier', 'name', 'description', 'private', 'archived'],
    user: ['_id', 'name', 'active', 'role'],
    label: ['_id', 'title', 'color', 'category', 'refCount'],
    document: ['_id', 'title', 'space', 'modifiedOn'],
    teamspace: ['_id', 'name', 'description', 'private', 'archived'],
    // Milestone `description` holds raw ProseMirror JSON, not prose — verbose and
    // unreadable in a listing. Ask for it explicitly via `fields` if needed.
    milestone: ['_id', 'label', 'status', 'targetDate'],
} as const;

export type ListEntity = keyof typeof LIST_FIELDS;

/**
 * Parse a `--fields` / `fields` argument. Returns `null` for "keep everything",
 * or the requested field names. Unknown names are kept as-is: a caller asking for
 * a field a document does not have simply gets no such key back.
 */
export function parseFields(spec: string | undefined, entity: ListEntity): string[] | null {
    if (spec === undefined) return [...LIST_FIELDS[entity]];
    const trimmed = spec.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'all') return null;
    const names = trimmed.split(',').map((f) => f.trim()).filter(Boolean);
    return names.length > 0 ? names : [...LIST_FIELDS[entity]];
}

/** Keep only `fields` on each row. `null` fields means pass rows through. */
export function projectRows<T extends Record<string, any>>(rows: T[], fields: string[] | null): any[] {
    if (fields === null) return rows;
    return rows.map((row) => {
        const out: Record<string, any> = {};
        for (const field of fields) {
            if (row[field] !== undefined) out[field] = row[field];
        }
        return out;
    });
}

export interface ListResult {
    /** Rows returned after the cap. */
    rows: any[];
    /** Rows that matched before the cap. */
    total: number;
    /** True when `total` exceeded the cap, so the caller knows to narrow or page. */
    truncated: boolean;
}

/**
 * Cap and project in one step. `limit` of 0 or a negative number is treated as
 * "no cap" so callers can opt out explicitly.
 */
export function shapeList<T extends Record<string, any>>(
    rows: T[],
    entity: ListEntity,
    options: { limit?: number; fields?: string } = {},
): ListResult {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const capped = limit > 0 ? rows.slice(0, limit) : rows;
    return {
        rows: projectRows(capped, parseFields(options.fields, entity)),
        total: rows.length,
        truncated: capped.length < rows.length,
    };
}
