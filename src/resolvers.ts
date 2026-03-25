import { HulyClient } from './client.js';

export interface ResolvedPerson {
    _id: string;
    name: string;
}

export interface ResolvedProject {
    _id: string;
    identifier: string;
    name: string;
}

export interface ResolvedStatus {
    _id: string;
    name: string;
}

/**
 * Resolve "me" or a name/ID to a person record.
 * - "me" → uses account's personUuid to find the Person
 * - otherwise tries matching by _id, name, or email
 */
export async function resolvePerson(client: HulyClient, input: string): Promise<ResolvedPerson> {
    if (input.toLowerCase() === 'me') {
        const account = await client.getAccount();
        const personUuid = account.fullSocialIds?.[0]?.personUuid || account.uuid;
        const persons = await client.getPersons();
        const me = persons.find((p: any) => p.personUuid === personUuid);
        if (!me) {
            throw new Error('Khong the xac minh tai khoan cua ban (me) tren he thong.');
        }
        return { _id: me._id, name: me.name || 'Ban' };
    }

    const persons = await client.getPersons();
    const match = persons.find((p: any) =>
        p._id === input ||
        p.name?.toLowerCase() === input.toLowerCase() ||
        p.email?.toLowerCase() === input.toLowerCase()
    );
    if (!match) {
        throw new Error(`Khong tim thay nguoi dung: ${input}`);
    }
    return { _id: match._id, name: match.name || input };
}

/**
 * Resolve a project by identifier, name, or _id.
 */
export async function resolveProject(client: HulyClient, input: string): Promise<ResolvedProject> {
    const projects = await client.getProjects();
    const match = projects.find((p: any) =>
        p.identifier === input ||
        p.name === input ||
        p._id === input
    );
    if (!match) {
        throw new Error(`Du an khong ton tai: ${input}`);
    }
    return { _id: match._id, identifier: match.identifier || '', name: match.name || '' };
}

/**
 * Resolve status by name (case-insensitive) or _id.
 * Optionally scope to a specific space first.
 */
export async function resolveStatus(client: HulyClient, input: string, spaceId?: string): Promise<ResolvedStatus> {
    const statuses = await client.getStatuses();
    const lower = input.toLowerCase();

    // Try space-scoped match first
    if (spaceId) {
        const scoped = statuses.find((s: any) =>
            s.space === spaceId && (s.name?.toLowerCase() === lower || s._id === input)
        );
        if (scoped) return { _id: scoped._id, name: scoped.name || input };
    }

    // Fallback to global match
    const global = statuses.find((s: any) =>
        s.name?.toLowerCase() === lower || s._id === input
    );
    if (global) return { _id: global._id, name: global.name || input };

    throw new Error(`Khong tim thay trang thai: '${input}'`);
}

/**
 * Resolve multiple status names/IDs to their _ids.
 * Returns matched IDs (silently skips unmatched).
 */
export async function resolveStatusIds(client: HulyClient, input: string): Promise<{ ids: string[]; statusMap: Map<string, any> }> {
    const statuses = await client.getStatuses();
    const statusMap = new Map<string, any>();
    for (const s of statuses) statusMap.set(s._id, s);

    const filters = input.split(',').map(s => s.trim().toLowerCase());
    const ids = statuses
        .filter((s: any) => filters.includes(s.name?.toLowerCase()) || filters.includes(s._id))
        .map((s: any) => s._id);

    return { ids, statusMap };
}

/**
 * Build a project map (id → project) for display purposes.
 */
export async function getProjectMap(client: HulyClient): Promise<Map<string, any>> {
    const projects = await client.getProjects();
    const map = new Map<string, any>();
    for (const p of projects) map.set(p._id, p);
    return map;
}

/**
 * Build a status map (id → status) for display purposes.
 */
export async function getStatusMap(client: HulyClient): Promise<Map<string, any>> {
    const statuses = await client.getStatuses();
    const map = new Map<string, any>();
    for (const s of statuses) map.set(s._id, s);
    return map;
}

const PRIORITY_MAP: Record<string, number> = {
    'low': 1, 'thap': 1,
    'medium': 2, 'trung binh': 2,
    'high': 3, 'cao': 3,
    'urgent': 4, 'khan cap': 4,
};

/**
 * Parse priority from string name or numeric string.
 * Returns a number 0-4. Defaults to 2 (medium).
 */
export function parsePriority(input: string | undefined): number {
    if (input === undefined) return 2;
    const lower = input.toLowerCase();
    if (lower in PRIORITY_MAP) return PRIORITY_MAP[lower];
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 0 && num <= 4) return num;
    return 2;
}

/**
 * Parse a due date from string.
 * Supports: "today", "tomorrow", "YYYY-MM-DD"
 * Returns a timestamp (end of day) or undefined.
 */
export function parseDate(input: string | undefined): number | undefined {
    if (!input) return undefined;
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    switch (input.toLowerCase()) {
        case 'today':
            return now.getTime();
        case 'tomorrow':
            now.setDate(now.getDate() + 1);
            return now.getTime();
        default: {
            const parsed = new Date(input);
            if (!isNaN(parsed.getTime())) {
                parsed.setHours(23, 59, 59, 999);
                return parsed.getTime();
            }
            return undefined;
        }
    }
}
