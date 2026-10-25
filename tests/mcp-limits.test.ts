import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { bundleSource } from './helpers/bundle.js';

const { createHulyMcpServer } = bundleSource('src/mcp/server.ts');

test('configured MCP server rejects excessive argument elements before a tool runs', async () => {
    const server = createHulyMcpServer();
    let calls = 0;
    server.registerTool('synthetic_probe', {
        inputSchema: z.object({ values: z.array(z.number()) }),
    }, async () => { calls++; return { content: [{ type: 'text', text: 'accepted' }] }; });
    const client = new Client({ name: 'synthetic', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
        await server.connect(a);
        await client.connect(b);
        // 1 object member + 15 array entries = 16 elements. Strings remain
        // scalar: document bodies do not lose their existing byte allowance.
        const accepted = await client.callTool({ name: 'synthetic_probe', arguments: { values: Array(15).fill(1) } });
        assert.equal(accepted.isError, undefined);
        assert.equal(calls, 1);
        const rejected = await client.callTool({ name: 'synthetic_probe', arguments: { values: Array(16).fill(1) } });
        assert.equal(rejected.isError, true);
        assert.equal(calls, 1, 'over-limit input must never reach the callback');
        assert.match(JSON.stringify(rejected), /maximum of 16 elements/);
        assert.ok(JSON.stringify(rejected).length < 1000, 'rejection must remain bounded');
    } finally { await client.close(); await server.close(); }
});

test('all existing Huly tool schemas fit the limit and strict validation remains available', async () => {
    const server = createHulyMcpServer();
    const client = new Client({ name: 'synthetic', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
        await server.connect(a); await client.connect(b);
        const { tools } = await client.listTools();
        assert.ok(tools.length > 20);
        for (const tool of tools) assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length <= 16, tool.name);
        const invalid = await client.callTool({ name: 'huly_create_task', arguments: { title: 'Synthetic', project: 'DEMO', wrongKey: 'x' } });
        assert.equal(invalid.isError, true);
        assert.match(JSON.stringify(invalid), /unrecognized|Unrecognized/);
    } finally { await client.close(); await server.close(); }
});
