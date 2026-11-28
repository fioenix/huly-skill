#!/usr/bin/env node

// Bootstrap (proxy + browser-API polyfills) must load before anything that
// touches the network or @hcengineering/api-client.
import '../bootstrap.js';
import { loadEnvFile } from '../env.js';
loadEnvFile();

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHulyMcpServer } from './server.js';
import { createHttpApp } from './http.js';

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

    // Stateless Streamable HTTP: a fresh server + transport per request.
    const app = createHttpApp(async (req, res) => {
        // A remote caller must not be able to write to this host's disk.
        const server = createHulyMcpServer({ allowDownloads: false });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    app.listen(port, () => {
        const auth = process.env.HULY_MCP_AUTH_TOKEN ? ' (auth required)' : '';
        process.stderr.write(`[huly-mcp] HTTP transport listening on :${port}/mcp${auth}\n`);
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
