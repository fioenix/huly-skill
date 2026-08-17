// Offline diagnostics. Every other code path has to reach Huly before it can say
// anything, which is exactly backwards when the problem is the configuration:
// a wrong workspace or a token belonging to someone else surfaces as a connection
// error, or worse, as a successful write under the wrong name. Everything here is
// derived locally from the environment and the token payload.

import { VERSION } from '../version.js';
import { credentialSource, maskToken, peekCredentials } from './auth.js';

export interface TokenClaims {
    account: string | null;
    workspace: string | null;
    /** Present on tokens minted with an expiry; most Huly tokens have none. */
    expiresOn: string | null;
    /** Keys only — values can carry `admin: 'true'` and similar. */
    extraKeys: string[];
}

/**
 * Read a Huly token's claims without verifying its signature. Verification needs
 * the server secret, which a client never has; the payload is still the only
 * local answer to "who would this write as".
 */
export function decodeTokenClaims(token: string | undefined): TokenClaims | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return {
            account: payload.account ?? null,
            workspace: payload.workspace ?? null,
            expiresOn: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
            extraKeys: payload.extra && typeof payload.extra === 'object' ? Object.keys(payload.extra) : [],
        };
    } catch {
        return null;
    }
}

/** Origin only — a Huly URL can carry a token in its path or query. */
function sanitizeHost(host: string | undefined): string | null {
    if (!host) return null;
    try {
        return new URL(host).origin;
    } catch {
        return null;
    }
}

export interface HulyContext {
    version: string;
    /** 'request' when the caller supplied a token, 'environment' otherwise. */
    credentialSource: 'request' | 'environment';
    host: string | null;
    workspace: string | null;
    apiKey: { present: boolean; masked: string; claims: TokenClaims | null };
    actor: string | null;
    defaultAssignee: string | null;
    proxy: boolean;
    /** Configuration problems detectable without a connection. */
    warnings: string[];
}

/**
 * Describe the current configuration without connecting to Huly. Never returns
 * the token, the password-bearing parts of a URL, or `extra` values.
 */
export function describeContext(): HulyContext {
    const credentials = peekCredentials();
    const host = credentials.host;
    const workspace = credentials.workspace?.trim() || null;
    const apiKey = credentials.token;
    const claims = decodeTokenClaims(apiKey);
    const warnings: string[] = [];

    if (!host) warnings.push('HULY_HOST is not set.');
    else if (sanitizeHost(host) === null) warnings.push(`HULY_HOST is not a valid URL: ${host}`);
    if (!workspace) warnings.push('HULY_WORKSPACE_ID is not set.');
    if (!apiKey) warnings.push('HULY_API_KEY is not set.');
    else if (claims === null) warnings.push('HULY_API_KEY is not a readable JWT — check it was copied whole.');

    if (claims !== null) {
        // A token carrying no workspace only resolves against a workspace URL
        // slug, so a UUID here fails with WorkspaceNotFound rather than
        // something that names the real cause.
        if (claims.workspace === null && workspace !== null && /^[0-9a-f-]{36}$/i.test(workspace)) {
            warnings.push(
                'This token is not bound to a workspace, so HULY_WORKSPACE_ID must be the workspace URL slug, not a UUID.',
            );
        }
        if (claims.workspace !== null && workspace !== null && claims.workspace !== workspace) {
            warnings.push(
                `Token is bound to workspace ${claims.workspace}, but HULY_WORKSPACE_ID is ${workspace}.`,
            );
        }
        if (claims.expiresOn !== null && Date.parse(claims.expiresOn) <= Date.now()) {
            warnings.push(`Token expired on ${claims.expiresOn}.`);
        }
    }

    return {
        version: VERSION,
        credentialSource: credentialSource(),
        host: sanitizeHost(host),
        workspace,
        apiKey: { present: apiKey !== undefined, masked: maskToken(apiKey ?? ''), claims },
        actor: process.env.HULY_ACTOR?.trim() || null,
        defaultAssignee: process.env.HULY_DEFAULT_ASSIGNEE?.trim() || null,
        proxy: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
        warnings,
    };
}
