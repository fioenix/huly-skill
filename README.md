# Huly Skill

A CLI + MCP server for managing tasks, projects, labels, documents, milestones, and comments in [Huly](https://huly.io) — built on the official [`@hcengineering/api-client`](https://github.com/hcengineering/huly-examples).

A portable integration for **Claude** (Code / Desktop), **Google Antigravity**, and **OpenAI Codex**. The same capabilities ship two ways:

- **Skill** — a file-based `SKILL.md` + zero-install bundled CLI. Loaded directly by Claude and Antigravity.
- **MCP server** — [`@fioenix/huly-mcp`](https://www.npmjs.com/package/@fioenix/huly-mcp), the universal interface. Works for all three (Codex has no skill system, so it uses MCP + `AGENTS.md`).

## Install per agent

| Agent | Recommended | How |
|-------|-------------|-----|
| **Claude Code / Desktop** | Skill | `npx skills add fioenix/huly-skill` (drops `SKILL.md` + `references/` into `.claude/skills/`). MCP also works — see below. |
| **Google Antigravity** | Skill | Copy `skills/huly-skill/` → `<project>/.agents/skills/huly-skill/` (or the global skills dir). MCP also works. |
| **OpenAI Codex** | MCP + `AGENTS.md` | Add the server to `~/.codex/config.toml` (snippet below); Codex reads [`AGENTS.md`](./AGENTS.md) for usage. |

Zero-install clone (any agent, no `npm install` needed):
```bash
git clone https://github.com/fioenix/huly-skill.git && cd huly-skill
```

All three use the same credentials (see [Setup](#setup)). Ready-to-paste MCP config templates per agent live in [`examples/agents/`](./examples/agents).

## Setup

Set these environment variables before using any command:

```bash
export HULY_HOST="https://huly.app"
export HULY_WORKSPACE_ID="your-workspace-uuid"
export HULY_API_KEY="your-api-token"
```

- **HULY_HOST**: Your Huly instance URL
- **HULY_WORKSPACE_ID**: Found in Huly Settings > Workspace
- **HULY_API_KEY**: issued from the workbench's workspace settings, admin-only — see below

### About the token

`HULY_API_KEY` is a JWT whose payload binds **one account to one workspace**:

```
{ "account": "<account uuid>", "workspace": "<workspace uuid>", "extra": {} }
```

Consequences worth knowing before you share one:

- **It acts as that person.** Everything created through it is attributed to that
  account, and runs with that account's role. There is no way to override the
  author from the client: `AuthOptions` accepts only credentials, no "on behalf
  of" field. A token shared across a team makes every task look like its owner's.
- **`me` is the token's owner**, not whoever is typing — unless `HULY_ACTOR`
  is set (below).
- **It carries no `exp` claim**, so it stays valid until the server's signing
  secret changes. Treat it like a password.

**Where a token comes from.** In the Huly workbench, API access tokens are
issued from the workspace settings area (Settings → General). That area is
restricted to workspace admins, so an ordinary member cannot mint one — on a
team, expect to ask an admin.

Two things follow, and they pull against each other:

- A token identifies **one account**, so correct attribution wants one token per
  person.
- Issuing tokens is **admin-only**, so getting one per person needs an admin to
  issue each of them.

If your admin issues a single token for everyone to share, every task will carry
that admin's name and that admin's role — usually `OWNER`. That is a workable
setup for a read-mostly integration and a poor one for a team that writes.

### Working around a shared token

When a team shares one token, set two optional variables per person:

```bash
export HULY_ACTOR="Nguyen Van A"       # who is operating this CLI
export HULY_DEFAULT_ASSIGNEE="me"      # assignee when --assignee is omitted
```

`HULY_ACTOR` makes `me` resolve to that person and appends
`Requested by: <name>` to tasks they create. `huly whoami` shows which identity
is in effect.

This is a **label, not a permission**. Huly still records the token's owner as
the author — there is no client-side way to change that — and anyone can set
`HULY_ACTOR` to any name. It answers "who asked for this", not "who is allowed
to do this", and it does nothing about the shared token's role.

`@hcengineering/api-client` also exposes
`getWorkspaceToken(host, { email, password, workspace })`, which returns a token
for whoever authenticates. Note this repo's pinned `@hcengineering/account-client`
(and its latest release) expose no token-creation call, so the settings screen is
the supported route.

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
huly create task "Sub-task" --project DELTA --parent DELTA-16   # as a sub-issue
huly update task DELTA-123 --status "Done" --add-comment "Completed"
huly delete task DELTA-123 --yes      # Requires confirmation
```

### Task kinds
```bash
huly kinds --project OMEGA            # Task types in a project → IDs for --kind-id
```

Kinds are scoped by project type, so the same name (e.g. `KPI`) can carry a
different ID in another project. Read the ID from the project you write to.

### People
```bash
huly users                            # Everyone in the workspace → IDs for --assignee
huly users --active-only              # Active members only
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

Reads `activity:class:DocUpdateMessage` + `chunter:class:ChatMessage`, resolves status and assignee refs to human names, and renders each comment body to markdown.

### Comments
```bash
huly comments list <objectId>                 # Comments on any object (issue, milestone, doc, …)
huly comments list <milestoneId> --class milestone
huly comments get <messageId>                 # One comment by _id (the "message" param in a chunter link)
```

Generalises comment reading beyond issues: queries `chunter:class:ChatMessage` by `attachedTo` (not hard-wired to `Issue`), so it works on milestones, documents, and any `Doc`. Thread replies (`chunter:class:ThreadMessage`) are nested under their parent in `replies`. Bodies are inline markup-JSON, converted to markdown locally. For issues, `huly activity <identifier>` is friendlier (accepts `LAMBD-568`, merges changes + comments).

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

A single entry point picks its transport from `HULY_MCP_TRANSPORT` (`stdio` default, or `http`). The server is **single-workspace**: one set of Huly credentials, shared by all callers. Full templates: [`examples/agents/`](./examples/agents).

### stdio — Claude (`.mcp.json`) and Antigravity (`~/.gemini/config/mcp_config.json`)

Both use the same `mcpServers` JSON shape:

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

Claude: `claude mcp add` or a project `.mcp.json`. Antigravity: place under `~/.gemini/config/mcp_config.json`.

### stdio — Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.huly]
command = "npx"
args = ["-y", "@fioenix/huly-mcp@latest"]

[mcp_servers.huly.env]
HULY_MCP_TRANSPORT = "stdio"
HULY_HOST = "https://huly.app"
HULY_WORKSPACE_ID = "your-workspace-uuid"
HULY_API_KEY = "your-api-token"
```

Or via CLI: `codex mcp add huly --env HULY_HOST=… --env HULY_WORKSPACE_ID=… --env HULY_API_KEY=… -- npx -y @fioenix/huly-mcp@latest`.

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

Building from source instead of npm: `pnpm build` produces `bin/mcp.cjs` (run with `node bin/mcp.cjs`). See [`npm-package/`](./npm-package) for the published package, and [RELEASING.md](./RELEASING.md) for the release checklist.

## For AI Agents

See [AGENTS.md](./AGENTS.md) for the full agent integration guide, or [skills/huly-skill/SKILL.md](./skills/huly-skill/SKILL.md) for the skill definition.

## Technical Notes

All dependencies are bundled into a single `bin/bundle.cjs` via esbuild — no `npm install` or GitHub PAT required. The `@hcengineering/api-client` expects browser APIs (`indexedDB`, `window`), which are polyfilled automatically.

## License

MIT
