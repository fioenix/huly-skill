# Huly Assist

A CLI tool and [agent skill](https://agentskills.io) for managing tasks, projects, labels, documents, and milestones in [Huly](https://huly.io) — built on the official [`@hcengineering/api-client`](https://github.com/hcengineering/huly-examples).

Works with Claude Code, Cursor, OpenCode, and any agent supporting the [Agent Skills](https://github.com/vercel-labs/skills) ecosystem.

## Install as Agent Skill

```bash
npx skills add fioenix/huly-skill
```

Or manually (zero-install — no `npm install` needed):
```bash
git clone https://github.com/fioenix/huly-skill.git
cd huly-skill
```

## Setup

Set these environment variables before using any command:

```bash
export HULY_HOST="https://huly.app"
export HULY_WORKSPACE_ID="your-workspace-uuid"
export HULY_API_KEY="your-api-token"
```

- **HULY_HOST**: Your Huly instance URL
- **HULY_WORKSPACE_ID**: Found in Huly Settings > Workspace
- **HULY_API_KEY**: Create at Huly Settings > API Tokens

### Verify

```bash
./bin/huly.cjs whoami
```

## Usage

### Tasks
```bash
huly tasks --assignee me              # My tasks
huly tasks --project DELTA --overdue  # Overdue in project
huly tasks --parent LAMBD-568         # Direct children of a parent (Epic / sub-issue group)
huly tasks --milestone-id <id>        # All tasks attached to a milestone
huly task DELTA-123                   # Task details by identifier
huly task-by-id <internalId>          # Lookup by internal _id (e.g. from childInfo)
huly create task "Title" --project DELTA --priority HIGH --due tomorrow
huly update task DELTA-123 --status "Done" --add-comment "Completed"
huly delete task DELTA-123 --yes      # Requires confirmation
```

### Sub-issue tree
```bash
huly sub-issues LAMBD-568             # Recursive tree (default)
huly sub-issues LAMBD-568 --no-recursive   # Direct children only
huly sub-issues LAMBD-568 --json --flat    # Flat list for programmatic use
```

Solves the "`tasks` only returns top-level" pain — walks `attachedTo` one `findAll` per level, no per-child round-trip.

### Activity feed
```bash
huly activity LAMBD-568                # Field changes + comments, newest first
huly activity LAMBD-568 --updates-only # Only status/assignee/label changes
huly activity LAMBD-568 --comments-only --json
```

Reads `activity:class:DocUpdateMessage` + `chunter:class:ChatMessage`, resolves status and assignee refs to human names.

### Reports
```bash
huly report daily --assignee me       # Today's summary
huly report weekly                    # Week summary
```

### Labels
```bash
huly labels list                      # All labels
huly labels create "bug" --color 3    # Create label
huly labels assign DELTA-123 <id>     # Assign to task
huly labels show DELTA-123            # Show task labels
```

### Documents
```bash
huly docs teamspaces                  # List teamspaces
huly docs list "My Documents"         # List docs
huly docs read "My Documents" "Notes" # Read as markdown
huly docs create "Title" -t "My Documents" --file ./content.md
huly docs create-teamspace "Engineering"
```

### Milestones
```bash
huly milestones list --project DELTA
huly milestones create "Sprint 1" --project DELTA --target 2026-04-15
huly milestones complete <id> --project DELTA
huly milestones report <milestoneId>            # Issues grouped by Epic with sub-trees
```

### JSON Mode

Append `--json` to any command for structured output:
```bash
huly tasks --assignee me --json
```

## MCP Server

Besides the CLI skill, the same Huly operations are exposed as an **MCP server** — a better fit for Claude Cowork and any MCP-capable client. It is published to npm as [`@fioenix/huly-mcp`](https://www.npmjs.com/package/@fioenix/huly-mcp) and runs via `npx` with no install step.

A single entry point picks its transport from `HULY_MCP_TRANSPORT` (`stdio` default, or `http`). The server is **single-workspace**: one set of Huly credentials, shared by all callers.

### stdio (local — Claude Code / Desktop)

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

### HTTP (remote — Claude Cowork)

```bash
HULY_MCP_TRANSPORT=http \
HULY_HOST=https://huly.app \
HULY_WORKSPACE_ID=your-workspace-uuid \
HULY_API_KEY=your-api-token \
HULY_MCP_AUTH_TOKEN=your-shared-secret \
npx -y @fioenix/huly-mcp@latest
```

Serves `POST /mcp` (default port 3000, override with `PORT`) and `GET /health`. When `HULY_MCP_AUTH_TOKEN` is set, callers must send `Authorization: Bearer <token>` — because the server holds Huly credentials, always set it for any non-local deployment.

Building from source instead of npm: `pnpm build` produces `bin/mcp.cjs` (run with `node bin/mcp.cjs`). See [`npm-package/`](./npm-package) for the published package.

## For AI Agents

See [AGENTS.md](./AGENTS.md) for the full agent integration guide, or [skills/huly-skill/SKILL.md](./skills/huly-skill/SKILL.md) for the skill definition.

## Technical Notes

All dependencies are bundled into a single `dist/bundle.cjs` via esbuild — no `npm install` or GitHub PAT required. The `@hcengineering/api-client` expects browser APIs (`indexedDB`, `window`), which are polyfilled automatically.

## License

MIT
