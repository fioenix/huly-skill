#!/usr/bin/env node

// Bootstrap (proxy + browser-API polyfills) must load before anything that
// touches the network or @hcengineering/api-client.
import '../bootstrap.js';
import { loadEnvFile } from '../env.js';
loadEnvFile();

import express, { type Request, type Response, type NextFunction } from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHulyMcpServer } from './server.js';

// Transport is chosen by env so a single bin works for every client:
//   HULY_MCP_TRANSPORT=stdio  (default) — local clients (Claude Code/Desktop)
//   HULY_MCP_TRANSPORT=http             — remote/hosted use (Claude Cowork)
const TRANSPORT = (process.env.HULY_MCP_TRANSPORT || 'stdio').toLowerCase();

async function startStdio(): Promise<void> {
    const server = createHulyMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stderr only — stdout is the MCP protocol channel.
    process.stderr.write('[huly-mcp] stdio transport ready\n');

    const shutdown = async () => { await server.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

function startHttp(): void {
    const port = Number(process.env.PORT || process.env.HULY_MCP_PORT || 3000);

    // Optional shared-secret guard. The server holds Huly credentials, so a
    // public deployment should set HULY_MCP_AUTH_TOKEN and have callers send
    // it as a Bearer token. When unset, the endpoint is open (local/dev use).
    const authToken = process.env.HULY_MCP_AUTH_TOKEN;

    const app = express();
    app.use(express.json());

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

    // Stateless Streamable HTTP: a fresh server + transport per request.
    app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
        const server = createHulyMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { void transport.close(); void server.close(); });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
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

    app.listen(port, () => {
        process.stderr.write(`[huly-mcp] HTTP transport listening on :${port}/mcp${authToken ? ' (auth required)' : ''}\n`);
    });
}

async function main(): Promise<void> {
    if (TRANSPORT === 'http') {
        startHttp();
    } else if (TRANSPORT === 'stdio') {
        await startStdio();
    } else {
        process.stderr.write(`[huly-mcp] unknown HULY_MCP_TRANSPORT="${TRANSPORT}" (expected "stdio" or "http")\n`);
        process.exit(1);
    }
}

main().catch((e) => {
    process.stderr.write(`[huly-mcp] fatal: ${e?.message || e}\n`);
    process.exit(1);
});
