/**
 * Web link of an issue: `<host>/workbench/<workspace slug>/tracker/<identifier>`.
 *
 * The slug is the workspace URL name (`workspaceUrl` from the account
 * service), not the UUID in HULY_WORKSPACE_ID. Returns null when any part is
 * missing, so a caller never prints a half-built link.
 *
 * Only the host's origin is used: people paste `user:pass@` or a whole
 * `?token=` sign-in URL into HULY_HOST, and the link ends up in output and
 * agent context (the same reason diagnostics use sanitizeHost).
 */
export function issueUrl(
    host: string | null | undefined,
    workspaceSlug: string | null | undefined,
    identifier: string | null | undefined,
): string | null {
    const base = httpOrigin(host);
    if (!base || !workspaceSlug || !identifier) return null;
    return `${base}/workbench/${encodeURIComponent(workspaceSlug)}/tracker/${encodeURIComponent(identifier)}`;
}

function httpOrigin(host: string | null | undefined): string | null {
    if (!host) return null;
    try {
        const url = new URL(host);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
    } catch {
        return null;
    }
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
