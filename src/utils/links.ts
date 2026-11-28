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

/** The text-view line for a task link, or nothing when there is no link. */
export function linkLine(url: string | null | undefined): string {
    return url ? `🔗 Link: ${url}\n` : '';
}

/**
 * Files and upload endpoints for a workspace, from the server config the
 * client already fetched — what api-client's connectStorage computes, without
 * fetching that config and selecting the workspace a second time.
 */
export function storageUrls(
    host: string,
    config: { FILES_URL: string; UPLOAD_URL?: string },
    workspaceId: string,
): { filesUrl: string; uploadUrl: string | null } {
    const base = host.replace(/\/+$/, '');
    const absolute = (url: string) => (url.startsWith('/') ? `${base}${url}` : url).replace(':workspace', workspaceId);
    return {
        filesUrl: absolute(config.FILES_URL),
        uploadUrl: config.UPLOAD_URL ? absolute(config.UPLOAD_URL) : null,
    };
}
