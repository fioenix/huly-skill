import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Credentials for one unit of work. The process environment is the default and
 * stays the default: a shared token in `HULY_API_KEY` remains a perfectly valid
 * way to run this tool. What this adds is a way for a caller to bring its own
 * token instead, so a server that several people talk to can attribute each
 * write to the person who asked rather than to whoever owns the server's token.
 */
export interface HulyCredentials {
    host?: string;
    workspace?: string;
    token?: string;
}

const credentialStore = new AsyncLocalStorage<HulyCredentials>();

/**
 * Why these caller credentials must be refused, or null when they are usable.
 * A caller that chooses the host or workspace must bring its own token too:
 * otherwise the server's own token would be sent to a host the caller picked,
 * or used on a workspace the deployment never configured. A caller-chosen host
 * must also be one the deployment allows, and comes with its own workspace.
 */
export function credentialsError(credentials: HulyCredentials): string | null {
    if (credentials.token === undefined) {
        const targets = [
            credentials.host !== undefined ? 'x-huly-url' : null,
            credentials.workspace !== undefined ? 'x-huly-workspace' : null,
        ].filter(Boolean);
        if (targets.length === 0) return null;
        const verb = targets.length === 1 ? 'requires' : 'require';
        return `${targets.join(' and ')} ${verb} x-huly-token: the server's own token is never sent to a caller-chosen host or workspace`;
    }
    if (credentials.host === undefined) return null;
    return hostError(credentials.host, credentials.workspace !== undefined);
}

/** An http(s) URL reduced to its origin, or null for anything else. */
function originOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch {
        return null;
    }
}

/**
 * The server connects to whatever `x-huly-url` names (its `/config.json`, then the
 * account and WebSocket endpoints listed there), so an arbitrary value lets any
 * caller make the server issue requests inside its own network. Only the
 * configured `HULY_HOST` and the origins listed in `HULY_MCP_ALLOWED_HOSTS` are
 * accepted. The server's `HULY_WORKSPACE_ID` belongs to its own host: a caller
 * pointing anywhere else names its workspace, or the server's id would be sent
 * there as part of the workspace login.
 */
function hostError(host: string, hasWorkspace: boolean): string | null {
    const origin = originOf(host);
    if (!origin) return 'x-huly-url must be an http(s) URL';
    const serverOrigin = originOf(process.env.HULY_HOST);
    if (origin === serverOrigin) return null;
    const allowed = (process.env.HULY_MCP_ALLOWED_HOSTS ?? '').split(',').map((h) => originOf(h));
    if (!allowed.includes(origin)) {
        return 'x-huly-url is not an allowed host: only HULY_HOST and the origins in HULY_MCP_ALLOWED_HOSTS are accepted';
    }
    if (!hasWorkspace) {
        return "x-huly-url requires x-huly-workspace: the server's own workspace is never sent to another host";
    }
    return null;
}

/**
 * Run `fn` with these credentials in scope. Fields left undefined fall back to
 * the environment, so a caller can override just the token.
 */
export function runWithCredentials<T>(credentials: HulyCredentials, fn: () => T): T {
    const refused = credentialsError(credentials);
    if (refused) throw new Error(refused);
    return credentialStore.run(credentials, fn);
}

/** Where the credentials in scope came from — reported by the diagnostics. */
export function credentialSource(): 'request' | 'environment' {
    return credentialStore.getStore()?.token !== undefined ? 'request' : 'environment';
}

/**
 * The credentials in scope, without throwing on missing ones. Diagnostics need to
 * describe a broken configuration, which is exactly when the getters throw.
 */
export function peekCredentials(): HulyCredentials {
    const scoped = credentialStore.getStore();
    return {
        host: scoped?.host ?? process.env.HULY_HOST,
        workspace: scoped?.workspace ?? process.env.HULY_WORKSPACE_ID,
        token: scoped?.token ?? process.env.HULY_API_KEY,
    };
}

export function getHost(): string {
    const host = credentialStore.getStore()?.host ?? process.env.HULY_HOST;
    if (!host) {
        throw new Error(
            'HULY_HOST is not set.\n' +
            '  → e.g. export HULY_HOST="https://huly.io"'
        );
    }
    return host;
}

export function getWorkspaceId(): string {
    const workspaceId = credentialStore.getStore()?.workspace ?? process.env.HULY_WORKSPACE_ID;
    if (!workspaceId) {
        throw new Error(
            'HULY_WORKSPACE_ID is not set.\n' +
            '  → Find the workspace ID under Huly Settings > Workspace.\n' +
            '  → Then: export HULY_WORKSPACE_ID="your-workspace-id"'
        );
    }
    return workspaceId;
}

export function getApiKey(): string {
    const token = credentialStore.getStore()?.token ?? process.env.HULY_API_KEY;
    if (!token) {
        throw new Error(
            'HULY_API_KEY is not set.\n' +
            '  → Take your own token from a signed-in Huly session, or ask an admin to mint one.\n' +
            '  → Then: export HULY_API_KEY="your-api-key"'
        );
    }
    return token;
}

export function maskToken(token: string): string {
    if (!token) return '';
    if (token.length <= 8) return '****';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
