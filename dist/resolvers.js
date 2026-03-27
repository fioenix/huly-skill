import fs from 'fs';
import path from 'path';
/**
 * Resolve "me" or a name/ID to a person record.
 * - "me" → uses account's personUuid to find the Person
 * - otherwise tries matching by _id, name, or email
 */
export async function resolvePerson(client, input) {
    if (input.toLowerCase() === 'me') {
        const account = await client.getAccount();
        const personUuid = account.fullSocialIds?.[0]?.personUuid || account.uuid;
        const persons = await client.getPersons();
        const me = persons.find((p) => p.personUuid === personUuid);
        if (!me) {
            throw new Error('Khong the xac minh tai khoan cua ban (me) tren he thong.');
        }
        return { _id: me._id, name: me.name || 'Ban' };
    }
    const persons = await client.getPersons();
    const match = persons.find((p) => p._id === input ||
        p.name?.toLowerCase() === input.toLowerCase() ||
        p.email?.toLowerCase() === input.toLowerCase());
    if (!match) {
        throw new Error(`Khong tim thay nguoi dung: ${input}`);
    }
    return { _id: match._id, name: match.name || input };
}
/**
 * Resolve a project by identifier, name, or _id.
 */
export async function resolveProject(client, input) {
    const projects = await client.getProjects();
    const match = projects.find((p) => p.identifier === input ||
        p.name === input ||
        p._id === input);
    if (!match) {
        throw new Error(`Du an khong ton tai: ${input}`);
    }
    return { _id: match._id, identifier: match.identifier || '', name: match.name || '' };
}
/**
 * Resolve status by name (case-insensitive) or _id.
 * Optionally scope to a specific space first.
 */
export async function resolveStatus(client, input, spaceId) {
    const statuses = await client.getStatuses();
    const lower = input.toLowerCase();
    // Try space-scoped match first
    if (spaceId) {
        const scoped = statuses.find((s) => s.space === spaceId && (s.name?.toLowerCase() === lower || s._id === input));
        if (scoped)
            return { _id: scoped._id, name: scoped.name || input };
    }
    // Fallback to global match
    const global = statuses.find((s) => s.name?.toLowerCase() === lower || s._id === input);
    if (global)
        return { _id: global._id, name: global.name || input };
    throw new Error(`Khong tim thay trang thai: '${input}'`);
}
/**
 * Resolve multiple status names/IDs to their _ids.
 * Returns matched IDs (silently skips unmatched).
 */
export async function resolveStatusIds(client, input) {
    const statuses = await client.getStatuses();
    const statusMap = new Map();
    for (const s of statuses)
        statusMap.set(s._id, s);
    const filters = input.split(',').map(s => s.trim().toLowerCase());
    const ids = statuses
        .filter((s) => filters.includes(s.name?.toLowerCase()) || filters.includes(s._id))
        .map((s) => s._id);
    return { ids, statusMap };
}
/**
 * Build a project map (id → project) for display purposes.
 */
export async function getProjectMap(client) {
    const projects = await client.getProjects();
    const map = new Map();
    for (const p of projects)
        map.set(p._id, p);
    return map;
}
/**
 * Build a status map (id → status) for display purposes.
 */
export async function getStatusMap(client) {
    const statuses = await client.getStatuses();
    const map = new Map();
    for (const s of statuses)
        map.set(s._id, s);
    return map;
}
const PRIORITY_MAP = {
    'low': 1, 'thap': 1,
    'medium': 2, 'trung binh': 2,
    'high': 3, 'cao': 3,
    'urgent': 4, 'khan cap': 4,
};
/**
 * Parse priority from string name or numeric string.
 * Returns a number 0-4. Defaults to 2 (medium).
 */
export function parsePriority(input) {
    if (input === undefined)
        return 2;
    const lower = input.toLowerCase();
    if (lower in PRIORITY_MAP)
        return PRIORITY_MAP[lower];
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 0 && num <= 4)
        return num;
    return 2;
}
/**
 * Parse a due date from string.
 * Supports: "today", "tomorrow", "YYYY-MM-DD"
 * Returns a timestamp (end of day) or undefined.
 */
/**
 * Parse raw field pairs (key=value) with type coercion.
 * Supports: null, true, false, integers, and strings.
 */
const RESERVED_FIELD_KEYS = new Set([
    '_id', '_class', 'space', 'status', 'priority', 'assignee', 'dueDate',
    'identifier', 'title', 'description', 'kind', 'component', 'milestone',
    '__proto__', 'constructor', 'prototype',
]);
export function parseRawFields(pairs) {
    const fields = {};
    for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1)
            continue;
        const key = pair.slice(0, idx);
        if (RESERVED_FIELD_KEYS.has(key)) {
            console.error(`⚠️ Khong the set reserved field '${key}' qua --set-field. Dung flag rieng.`);
            continue;
        }
        const raw = pair.slice(idx + 1);
        if (raw === 'null')
            fields[key] = null;
        else if (raw === 'true')
            fields[key] = true;
        else if (raw === 'false')
            fields[key] = false;
        else if (/^-?\d+$/.test(raw))
            fields[key] = Number(raw);
        else
            fields[key] = raw;
    }
    return fields;
}
const ALLOWED_FILE_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);
export function safeReadFile(filePath) {
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();
    if (ext && !ALLOWED_FILE_EXTENSIONS.has(ext)) {
        throw new Error(`--description-file chi chap nhan file .md, .txt, .markdown (nhan: ${ext})`);
    }
    return fs.readFileSync(resolved, 'utf8');
}
export function parseDate(input) {
    if (!input)
        return undefined;
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
