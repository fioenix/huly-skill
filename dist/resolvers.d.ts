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
export declare function resolvePerson(client: HulyClient, input: string): Promise<ResolvedPerson>;
/**
 * Resolve a project by identifier, name, or _id.
 */
export declare function resolveProject(client: HulyClient, input: string): Promise<ResolvedProject>;
/**
 * Resolve status by name (case-insensitive) or _id.
 * Optionally scope to a specific space first.
 */
export declare function resolveStatus(client: HulyClient, input: string, spaceId?: string): Promise<ResolvedStatus>;
/**
 * Resolve multiple status names/IDs to their _ids.
 * Returns matched IDs (silently skips unmatched).
 */
export declare function resolveStatusIds(client: HulyClient, input: string): Promise<{
    ids: string[];
    statusMap: Map<string, any>;
}>;
/**
 * Build a project map (id → project) for display purposes.
 */
export declare function getProjectMap(client: HulyClient): Promise<Map<string, any>>;
/**
 * Build a status map (id → status) for display purposes.
 */
export declare function getStatusMap(client: HulyClient): Promise<Map<string, any>>;
/**
 * Parse priority from string name or numeric string.
 * Returns a number 0-4. Defaults to 2 (medium).
 */
export declare function parsePriority(input: string | undefined): number;
export declare function parseRawFields(pairs: string[]): Record<string, any>;
export declare function safeReadFile(filePath: string): string;
export declare function parseDate(input: string | undefined): number | undefined;
