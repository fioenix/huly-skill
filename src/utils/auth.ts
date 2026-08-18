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
 * Run `fn` with these credentials in scope. Fields left undefined fall back to
 * the environment, so a caller can override just the token.
 */
export function runWithCredentials<T>(credentials: HulyCredentials, fn: () => T): T {
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
