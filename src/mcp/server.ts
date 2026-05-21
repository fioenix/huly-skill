import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHulyTools } from './tools.js';

const INSTRUCTIONS = [
    'Tools manage tasks, projects, labels, documents, and milestones in a Huly',
    'workspace. Every tool returns a JSON envelope: { "status": "ok", ... } on',
    'success or { "status": "error", "error": "..." } on failure.',
    'Identifiers like DELTA-123 are task identifiers; projects, assignees, and',
    'statuses can be referenced by name or id. huly_delete_task is irreversible',
    'and requires confirm=true.',
].join(' ');

/**
 * Build a fully-configured Huly MCP server. A fresh instance is created per
 * stdio process and per stateless HTTP request.
 */
export function createHulyMcpServer(): McpServer {
    const server = new McpServer(
        { name: 'huly-mcp', version: '1.1.0' },
        { instructions: INSTRUCTIONS },
    );
    registerHulyTools(server);
    return server;
}
