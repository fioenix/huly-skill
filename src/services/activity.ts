import { HulyClient } from '../client.js';
import { getStatusMap } from '../resolvers.js';

export interface ActivityEvent {
    id: string;
    kind: 'update' | 'comment';
    action?: 'create' | 'update' | 'remove';
    timestamp: number;
    createdOn: number | null;
    actor: string | null;
    actorId: string;
    /** For DocUpdateMessage: human-readable change list. */
    changes?: ActivityChange[];
    /** For ChatMessage: comment body as markdown. */
    message?: string | null;
}

export interface ActivityChange {
    attribute: string;
    from: string | number | null;
    to: string | number | null;
    added?: (string | number)[];
    removed?: (string | number)[];
}

export interface ActivityResult {
    taskIdentifier: string;
    taskInternalId: string;
    count: number;
    events: ActivityEvent[];
}

const SOCIAL_ID_LABEL_CACHE: Map<string, string> = new Map();

/**
 * Build a unified activity feed for a single issue: doc-update events plus
 * comments, sorted newest first and enriched with human-readable names
 * where possible.
 *
 * Resolution caveats:
 *   - `modifiedBy` is a Huly social-id, not a Person _id. The mapping
 *     lives in `account.fullSocialIds` server-side; we settle for matching
 *     `personUuid` via the cached person list when possible, and otherwise
 *     surface the raw social-id so callers can still reason about it.
 *   - `attributeUpdates[].set[0]` and `prevValue` are raw refs (Status,
 *     Person, etc). We resolve `status` against the status map; other
 *     attributes are returned as-is for now (good enough for the common
 *     "what changed" view; can grow later).
 */
export async function getIssueActivity(
    client: HulyClient,
    taskIdentifier: string,
    limit: number = 200,
): Promise<ActivityResult> {
    const task = await client.getTask(taskIdentifier);
    if (!task) throw new Error(`Task not found: ${taskIdentifier}`);

    const [updates, comments, statusMap, persons, socialIds] = await Promise.all([
        client.getIssueDocUpdates(task._id, limit),
        client.getIssueComments(task._id, limit),
        getStatusMap(client),
        client.getPersons(),
        client.getSocialIdentities(),
    ]);

    const personMap = new Map<string, any>();
    for (const p of persons) personMap.set(p._id, p);

    const socialIdToName = buildSocialIdMap(persons, socialIds);
    const ctx: ResolveCtx = { statusMap, personMap };

    const updateEvents: ActivityEvent[] = updates.map((u: any) => ({
        id: u._id,
        kind: 'update',
        action: u.action,
        timestamp: u.modifiedOn,
        createdOn: u.createdOn ?? null,
        actor: socialIdToName.get(u.modifiedBy) ?? null,
        actorId: u.modifiedBy,
        changes: extractChanges(u, ctx),
    }));

    const commentEvents: ActivityEvent[] = await Promise.all(
        comments.map(async (c: any): Promise<ActivityEvent> => {
            // ChatMessage.message is inline markup JSON, not a blob ref —
            // fetchMarkup 500s on it, so convert locally.
            const message = client.renderMarkup(c.message);
            return {
                id: c._id,
                kind: 'comment',
                timestamp: c.modifiedOn,
                createdOn: c.createdOn ?? null,
                actor: socialIdToName.get(c.modifiedBy) ?? null,
                actorId: c.modifiedBy,
                message,
            };
        }),
    );

    const events = [...updateEvents, ...commentEvents].sort(
        (a, b) => b.timestamp - a.timestamp,
    );

    return {
        taskIdentifier: task.identifier,
        taskInternalId: task._id,
        count: events.length,
        events,
    };
}

interface ResolveCtx {
    statusMap: Map<string, any>;
    personMap: Map<string, any>;
}

function extractChanges(update: any, ctx: ResolveCtx): ActivityChange[] {
    // Huly stores `attributeUpdates` as either a single object or an array
    // depending on event shape. Normalise to array before mapping.
    const raw = update.attributeUpdates;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    if (arr.length === 0) return [];

    return arr
        .filter((u: any) => u && u.attrKey)
        .map((u: any): ActivityChange => {
            const attr = u.attrKey;
            const setValue = Array.isArray(u.set) ? u.set[0] : u.set;
            return {
                attribute: attr,
                from: u.prevValue !== undefined
                    ? resolveAttrValue(attr, u.prevValue, ctx)
                    : null,
                to: resolveAttrValue(attr, setValue, ctx),
                added: Array.isArray(u.added) && u.added.length > 0
                    ? u.added.map((v: any) => resolveAttrValue(attr, v, ctx) ?? v)
                    : undefined,
                removed: Array.isArray(u.removed) && u.removed.length > 0
                    ? u.removed.map((v: any) => resolveAttrValue(attr, v, ctx) ?? v)
                    : undefined,
            };
        });
}

function resolveAttrValue(
    attribute: string,
    value: any,
    ctx: ResolveCtx,
): string | number | null {
    if (value === null || value === undefined) return null;
    if (attribute === 'status') {
        return ctx.statusMap.get(value)?.name ?? String(value);
    }
    if (attribute === 'assignee') {
        return ctx.personMap.get(value)?.name ?? String(value);
    }
    if (typeof value === 'number') return value;
    return String(value);
}

export function buildSocialIdMap(persons: any[], socialIds: any[] = []): Map<string, string> {
    // Reset on each call so credentials swap doesn't poison the cache.
    SOCIAL_ID_LABEL_CACHE.clear();
    const nameByPerson = new Map<string, string>();
    for (const p of persons) {
        const name = p.name || p.displayName;
        if (!name) continue;
        nameByPerson.set(p._id, name);
        if (p.personUuid) SOCIAL_ID_LABEL_CACHE.set(p.personUuid, name);
        if (p._id) SOCIAL_ID_LABEL_CACHE.set(p._id, name);
    }
    // `modifiedBy` on docs is a SocialIdentity._id, not a Person._id — map it
    // through `attachedTo` to the owning person's name.
    for (const sid of socialIds) {
        const name = nameByPerson.get(sid.attachedTo);
        if (name) SOCIAL_ID_LABEL_CACHE.set(sid._id, name);
    }
    return SOCIAL_ID_LABEL_CACHE;
}
