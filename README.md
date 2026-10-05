# Huly Skill

[![CI](https://github.com/fioenix/huly-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/fioenix/huly-skill/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40fioenix%2Fhuly-mcp)](https://www.npmjs.com/package/@fioenix/huly-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A **CLI, MCP server, and agent skill for [Huly](https://huly.io) project management**.
Manage tasks, projects, labels, documents, milestones, and comments from Claude
Code, Codex, and other AI agents, using the official
[`@hcengineering/api-client`](https://github.com/hcengineering/huly-examples).

- **CLI** — a committed Node.js bundle; run from a clone without `npm install`.
- **Agent skill** — `SKILL.md` and reference guides for skill-capable agents,
  including Claude Code, Codex, Cursor, and Google Antigravity.
- **MCP server** — [`@fioenix/huly-mcp`](https://www.npmjs.com/package/@fioenix/huly-mcp),
  with local stdio and Streamable HTTP transports for MCP-capable clients.

[Quickstart](#quickstart-read-only) · [Synthetic demo](./examples/demo/README.md) ·
[Agent setup](#install-per-agent) · [MCP configuration](#mcp-server)

## Quickstart (read-only)

Requires **Node.js 20.18.1+**, access to a Huly workspace, and an API token issued
by its admin. For an offline preview with no credentials, run the
[synthetic demo](./examples/demo/README.md).

```bash
git clone https://github.com/fioenix/huly-skill.git
cd huly-skill
node bin/huly.cjs --help
```

Keep credentials outside the repository in `~/.huly/.env` (see [Setup](#setup)
for token issuance and attribution):

```dotenv
HULY_HOST=https://huly.app
HULY_WORKSPACE_ID=your-workspace-uuid
HULY_API_KEY=your-api-token
```

Replace the placeholders in that file with your own values. The CLI loads it
automatically; existing environment variables take precedence.

```bash
node bin/huly.cjs whoami --offline   # local config check; no Huly connection
node bin/huly.cjs whoami             # confirm the connected identity
node bin/huly.cjs tasks --assignee me --limit 5 --fields identifier,title --json
```

These commands read configuration and workspace data without creating or updating
anything. They do **not** restrict the token to read-only permissions. `me` is the
token owner unless `HULY_ACTOR` is set. Keep real outputs private; the examples
below use invented data.

```json
{
  "status": "ok",
  "count": 2,
  "total": 2,
  "truncated": false,
  "data": [
    { "identifier": "DEMO-1", "title": "Draft the sample onboarding guide" },
    { "identifier": "DEMO-2", "title": "Review the sample release checklist" }
  ]
}
```

The CLI returns uncapped results unless you pass `--limit`; `--fields` keeps JSON
output small. When `truncated` is true, narrow the filters or deliberately raise
the limit before treating the result as complete.

## Install per agent

| Agent | Skill instructions | MCP alternative |
|-------|--------------------|-----------------|
| **Claude Code** | `npx skills add fioenix/huly-skill --skill huly-skill --agent claude-code` | [Claude config](./examples/agents/claude.mcp.json) |
| **OpenAI Codex** | `npx skills add fioenix/huly-skill --skill huly-skill --agent codex` | [Codex config](./examples/agents/codex.config.toml) |
| **Cursor** | `npx skills add fioenix/huly-skill --skill huly-skill --agent cursor` | Use your client's `mcpServers` configuration |
| **Google Antigravity** | `npx skills add fioenix/huly-skill --skill huly-skill --agent antigravity` | [Antigravity config](./examples/agents/antigravity.mcp_config.json) |
| **Claude Desktop / Cowork** | Use the packaged skill ZIP where the client supports skill uploads | [MCP server](#mcp-server); HTTP for remote clients |

Run the installer from the project where you want the skill available. It installs
**instructions and references** from `skills/huly-skill/`; the executable bundle
lives at the repository root. Use the cloned CLI from the quickstart, or install
the complete packaged skill instead:

```bash
# From the clone, for a Codex project (replace the destination path):
mkdir -p /path/to/your-project/.agents/skills
unzip huly-skill.zip -d /path/to/your-project/.agents/skills
```

The ZIP includes `huly-skill/bin/huly.cjs` and its dependency bundle. Choose one
installation method for a given destination; do not overwrite an existing skill
installation. Codex supports both [agent skills](https://developers.openai.com/codex/skills/)
and MCP, and reads this repo's [AGENTS.md](./AGENTS.md) as repository guidance.

The [skills installer](https://github.com/vercel-labs/skills#supported-agents)
supports many agents. That is installer compatibility, not a claim that this
Huly integration has been tested in every client. All routes use the same Huly
credentials. Ready-to-paste MCP templates live in
[`examples/agents/`](./examples/agents).

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

Success is `{ "status": "ok", … }`; failure is:
```json
{ "status": "error", "error": "Task not found: DELTA-9", "code": "not_found", "retryable": false }
```
`code` is one of `auth`, `connection`, `not_found`, `invalid_input`, `unknown`, and
only `connection` is retryable — repeating any other call unchanged fails the same
way. `auth` errors carry a `hint`. The MCP tools return the identical envelope.

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

**Per-caller Huly credentials.** A caller can bring its own token so Huly attributes
its writes to it rather than to whoever owns the server's token:

| Header | Overrides |
|--------|-----------|
| `x-huly-token` | `HULY_API_KEY` |
| `x-huly-url` | `HULY_HOST` |
| `x-huly-workspace` | `HULY_WORKSPACE_ID` |

The process environment stays the default, so a shared token keeps working
unchanged. Set `HULY_REQUIRE_CALLER_TOKEN=true` to reject requests that omit
`x-huly-token` with `401` instead of quietly falling back to the server's token —
worth doing on any deployment where attribution matters. `huly_context` reports
which source is in effect.

Building from source instead of npm: `pnpm build` produces `bin/mcp.cjs` (run with `node bin/mcp.cjs`). See [`npm-package/`](./npm-package) for the published package, and [RELEASING.md](./RELEASING.md) for the release checklist.

## For AI Agents

See [AGENTS.md](./AGENTS.md) for the full agent integration guide, or [skills/huly-skill/SKILL.md](./skills/huly-skill/SKILL.md) for the skill definition.

## Technical Notes

All dependencies are bundled into a single `bin/bundle.cjs` via esbuild — no `npm install` or GitHub PAT required. The `@hcengineering/api-client` expects browser APIs (`indexedDB`, `window`), which are polyfilled automatically.

## Prior art and thanks

[`dearlordylord/huly-mcp`](https://github.com/dearlordylord/huly-mcp) (npm
[`@firfi/huly-mcp`](https://www.npmjs.com/package/@firfi/huly-mcp)) started in
February 2026, six weeks before this project, and covers far more of Huly than we
do. Reading it sharpened this codebase in several concrete ways: an offline
configuration tool, per-caller credentials over HTTP headers, machine-readable error
codes, release-artifact verification, and the discipline of capping and projecting
list results all began as ideas taken from there — each
reimplemented in this project's own style, kept deliberately smaller. Their
[lazy-tool PRD](https://github.com/dearlordylord/huly-mcp/blob/main/docs/02_LAZY_TOOL_PRD.md)
is also the best measurement of MCP tool-surface context cost we have found
anywhere, and it independently reached the same conclusion we did about Huly's
unreleased revocable API tokens.

Thanks to its author. Two projects can solve the same problem at different scales
and both be right: theirs goes wide, this one stays small enough to read in one
sitting. A criterion-by-criterion comparison, including where they are ahead and
where we deliberately diverge, is in
[reference/comparison.md](./reference/comparison.md).

## Contributing

Bug reports, feature requests and pull requests are welcome — see
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to build, test and verify a change,
and for what this project deliberately says no to. Vulnerabilities go through
[SECURITY.md](./SECURITY.md) rather than a public issue.

## License

MIT
