import crypto from 'node:crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { credentialsError, runWithCredentials, type HulyCredentials } from '../utils/auth.js';
import { classifyError } from '../utils/errors.js';
import { redactUrl } from '../utils/proxy.js';

/** Serves one MCP request; runs inside the caller's credential scope. */
export type McpRequestHandler = (req: Request, res: Response) => Promise<void>;

/**
 * The HTTP transport's express app, without the MCP server itself, so the
 * credential boundary can be tested without loading the Huly client.
 */
export function createHttpApp(handle: McpRequestHandler): Express {
    // Optional shared-secret guard. The server holds Huly credentials, so a
    // public deployment should set HULY_MCP_AUTH_TOKEN and have callers send
    // it as a Bearer token. When unset, the endpoint is open (local/dev use).
    const authToken = process.env.HULY_MCP_AUTH_TOKEN;
    // The HTTP parser trims the Authorization header, so a padded secret could
    // never match, and trimming it here would turn a blank one into an open
    // endpoint. Neither is what the operator meant: refuse to start.
    if (authToken && authToken.trim() !== authToken) {
        throw new Error('HULY_MCP_AUTH_TOKEN is blank or has leading/trailing whitespace; set the secret exactly, or unset it');
    }
    const authDigest = authToken ? digest(authToken) : null;

    const app = express();
    app.disable('x-powered-by');

    // Per-caller Huly credentials. A caller may bring its own token so its writes
    // are attributed to it rather than to whoever owns the server's token; the
    // process environment stays the default when it doesn't.
    const requireCallerToken = (req: Request, res: Response, next: NextFunction) => {
        if (process.env.HULY_REQUIRE_CALLER_TOKEN !== 'true') return next();
        // Trimmed as the credential scope trims it: a value that trims to nothing
        // (U+00A0 gets past the HTTP parser) would fall back to HULY_API_KEY.
        if (!req.header('x-huly-token')?.trim()) {
            res.status(401).json({ error: 'x-huly-token header required (HULY_REQUIRE_CALLER_TOKEN=true)' });
            return;
        }
        next();
    };

    const credentialsFromRequest = (req: Request): HulyCredentials => ({
        token: req.header('x-huly-token') || undefined,
        host: req.header('x-huly-url') || undefined,
        workspace: req.header('x-huly-workspace') || undefined,
    });

    const requireAuth = (req: Request, res: Response, next: NextFunction) => {
        if (!authDigest) return next();
        const header = req.header('authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        // Hashing first gives both sides one length, so the comparison takes the
        // same time however much of a guess is right, and whatever its length.
        if (!crypto.timingSafeEqual(digest(token), authDigest)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    };

    app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

    // The body is parsed only once the caller is through the guards.
    app.post('/mcp', requireAuth, requireCallerToken, express.json(), async (req: Request, res: Response) => {
        const credentials = credentialsFromRequest(req);
        const refused = credentialsError(credentials);
        if (refused) {
            res.status(400).json({ error: refused });
            return;
        }
        try {
            await runWithCredentials(credentials, () => handle(req, res));
        } catch (e: unknown) {
            // The message can name internal hosts, paths or upstream replies, so
            // it goes to the operator's log and the caller gets a generic one.
            logFailure(e);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal error' });
            }
        }
    });

    // Stateless mode has no sessions — GET/DELETE are not supported.
    const methodNotAllowed = (_req: Request, res: Response) =>
        res.status(405).json({ error: 'Method Not Allowed' });
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);

    // Express's default handler answers with an HTML page that carries the stack
    // trace outside production; every error here is answered with plain JSON.
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const type = (err as { type?: unknown })?.type;
        const status = (err as { status?: unknown })?.status;
        if (res.headersSent) return;
        if (type === 'entity.parse.failed') {
            res.status(400).json({ error: 'Invalid JSON' });
        } else if (type === 'entity.too.large') {
            res.status(413).json({ error: 'Request body too large' });
        } else if (typeof status === 'number' && status >= 400 && status < 500) {
            res.status(status).json({ error: 'Bad request' });
        } else {
            logFailure(err);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    return app;
}

function digest(value: string): Buffer {
    return crypto.createHash('sha256').update(value).digest();
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi;
const JWT_PATTERN = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g;

/**
 * Error text made safe for the operator log: a Huly WebSocket URL carries the
 * account JWT in its path and a host may carry `user:pass@` or `?token=`, so
 * URLs are cut to scheme and host and JWT-shaped strings are masked. Control
 * characters go too, so a caller-influenced message cannot forge log lines.
 */
function logSafe(text: string): string {
    return text
        .replace(URL_PATTERN, (url) => redactUrl(url))
        .replace(JWT_PATTERN, '<jwt>')
        // Cc is C0, DEL and C1 (NEL, CSI); Zl/Zp are the Unicode line breaks.
        .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
        .trim();
}

function logFailure(e: unknown): void {
    const messageOf = (value: unknown) => {
        const message = (value as { message?: unknown })?.message;
        return typeof message === 'string' ? message : String(value ?? '');
    };
    // Node's network errors put the useful part in `cause` (`fetch failed` alone
    // says nothing).
    const cause = (e as { cause?: unknown })?.cause;
    const text = [messageOf(e), cause ? `cause: ${messageOf(cause)}` : ''].filter(Boolean).join('; ');
    process.stderr.write(`[huly-mcp] request failed (${classifyError(e)}): ${logSafe(text)}\n`);
}

/**
 * Where the HTTP transport listens. Without `HULY_MCP_AUTH_TOKEN` the endpoint is
 * open and acts with the server's Huly token, so it stays on loopback unless
 * `HULY_MCP_HOST` names an address. With the token set it listens on every
 * interface (`undefined`), as before, for hosted deployments.
 */
export function listenHost(env: NodeJS.ProcessEnv): string | undefined {
    const host = env.HULY_MCP_HOST?.trim();
    if (host) return host;
    return env.HULY_MCP_AUTH_TOKEN?.trim() ? undefined : '127.0.0.1';
}

/** `host:port` for the startup line, with an IPv6 literal in brackets. */
export function listenAddress(host: string | undefined, port: number): string {
    if (!host) return `:${port}`;
    return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
