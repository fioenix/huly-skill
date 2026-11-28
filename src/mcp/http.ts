import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { credentialsError, runWithCredentials, type HulyCredentials } from '../utils/auth.js';

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

    const app = express();
    app.use(express.json());

    // Per-caller Huly credentials. A caller may bring its own token so its writes
    // are attributed to it rather than to whoever owns the server's token; the
    // process environment stays the default when it doesn't.
    const requireCallerToken = (req: Request, res: Response, next: NextFunction) => {
        if (process.env.HULY_REQUIRE_CALLER_TOKEN !== 'true') return next();
        if (!req.header('x-huly-token')) {
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
        if (!authToken) return next();
        const header = req.header('authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (token !== authToken) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    };

    app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

    app.post('/mcp', requireAuth, requireCallerToken, async (req: Request, res: Response) => {
        const credentials = credentialsFromRequest(req);
        const refused = credentialsError(credentials);
        if (refused) {
            res.status(400).json({ error: refused });
            return;
        }
        try {
            await runWithCredentials(credentials, () => handle(req, res));
        } catch (e: any) {
            if (!res.headersSent) {
                res.status(500).json({ error: e?.message || 'Internal error' });
            }
        }
    });

    // Stateless mode has no sessions — GET/DELETE are not supported.
    const methodNotAllowed = (_req: Request, res: Response) =>
        res.status(405).json({ error: 'Method Not Allowed' });
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);

    return app;
}
