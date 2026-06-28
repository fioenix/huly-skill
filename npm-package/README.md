# @fioenix/huly-mcp

MCP server for [Huly](https://huly.io) project management. Exposes tasks, projects, labels, documents, and milestones as MCP tools — usable from any MCP client (Claude Code, Claude Desktop, Claude Cowork).

The package is a single self-contained bundle: `npx` runs it with no install step.

## Configuration

The server needs 3 environment variables and is **single-workspace** (one Huly workspace, shared by all callers):

| Variable | Description |
|---|---|
| `HULY_HOST` | Huly instance URL, e.g. `https://huly.app` |
| `HULY_WORKSPACE_ID` | Workspace UUID (Huly Settings → Workspace) |
| `HULY_API_KEY` | API token (Huly Settings → API Tokens) |

Transport is selected by `HULY_MCP_TRANSPORT` — `stdio` (default) or `http`.

## Usage — stdio (local clients)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "huly": {
      "command": "npx",
      "args": ["-y", "@fioenix/huly-mcp@latest"],
      "env": {
        "HULY_MCP_TRANSPORT": "stdio",
        "HULY_HOST": "https://huly.app",
        "HULY_WORKSPACE_ID": "your-workspace-uuid",
        "HULY_API_KEY": "your-api-token"
      }
    }
  }
}
```

## Usage — HTTP (remote / Claude Cowork)

```bash
HULY_MCP_TRANSPORT=http \
HULY_HOST=https://huly.app \
HULY_WORKSPACE_ID=your-workspace-uuid \
HULY_API_KEY=your-api-token \
HULY_MCP_AUTH_TOKEN=your-shared-secret \
npx -y @fioenix/huly-mcp@latest
```

Serves `POST /mcp` (default port `3000`, override with `PORT`) and `GET /health`. When `HULY_MCP_AUTH_TOKEN` is set, callers must send `Authorization: Bearer <token>` — because the server holds Huly credentials, always set it for any non-local deployment.

## Tools

`huly_whoami`, `huly_list_projects`, `huly_list_tasks`, `huly_get_task`, `huly_get_task_by_id`, `huly_list_sub_issues`, `huly_create_task`, `huly_update_task`, `huly_delete_task`, `huly_get_activity`, `huly_get_comments`, `huly_get_comment`, `huly_report`, `huly_list_labels`, `huly_create_label`, `huly_assign_label`, `huly_show_labels`, `huly_list_teamspaces`, `huly_list_documents`, `huly_read_document`, `huly_create_document`, `huly_create_teamspace`, `huly_list_milestones`, `huly_create_milestone`, `huly_complete_milestone`, `huly_milestone_report`.

`huly_get_comments` reads comments on **any** object (issue, milestone, document, …) by its internal `_id`, with thread replies nested in `replies`; `huly_get_comment` resolves a single comment by the `message` `_id` from a chunter link.

Every tool returns a JSON envelope: `{ "status": "ok", ... }` or `{ "status": "error", "error": "..." }`.

## License

MIT — source at [github.com/fioenix/huly-skill](https://github.com/fioenix/huly-skill).
