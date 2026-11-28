/**
 * Web link of an issue: `<host>/workbench/<workspace slug>/tracker/<identifier>`.
 *
 * The slug is the workspace URL name (`workspaceUrl` from the account
 * service), not the UUID in HULY_WORKSPACE_ID. Returns null when any part is
 * missing, so a caller never prints a half-built link.
 */
export function issueUrl(
    host: string | null | undefined,
    workspaceSlug: string | null | undefined,
    identifier: string | null | undefined,
): string | null {
    const base = (host ?? '').replace(/\/+$/, '');
    if (!base || !workspaceSlug || !identifier) return null;
    return `${base}/workbench/${encodeURIComponent(workspaceSlug)}/tracker/${encodeURIComponent(identifier)}`;
}
