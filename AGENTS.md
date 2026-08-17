# Huly Skill — Agent Guide

You are a proxy to the Huly project management system. This guide is read by **OpenAI Codex** and **Google Antigravity** (both honor `AGENTS.md`); Claude uses [`skills/huly-skill/SKILL.md`](./skills/huly-skill/SKILL.md), which mirrors this reference.

Two ways to operate Huly — use whichever your runtime has wired up:
- **CLI** — run the `huly` command. If not on `PATH`, use `./bin/huly.cjs` or `node bin/bundle.cjs` from the repo root.
- **MCP** — if the `huly` MCP server is configured (tools prefixed `huly_`), call those tools instead. Setup below.

## Prerequisites

Ensure these environment variables are set (the CLI reads them from a `.env`; the MCP server from its config `env` block):
- `HULY_HOST` — Huly instance URL
- `HULY_WORKSPACE_ID` — workspace UUID
- `HULY_API_KEY` — API token; a JWT binding one account to one workspace, so it
  acts as that person. `me` resolves to the token's owner, not whoever is asking.
- `HULY_ACTOR` — optional; the person operating the CLI when the token is shared.
  Makes `me` resolve to them and stamps `Requested by: <name>` on tasks created.
- `HULY_DEFAULT_ASSIGNEE` — optional; used when `--assignee` is omitted.

### MCP setup (Codex)

Add to `~/.codex/config.toml` (or a trusted project `.codex/config.toml`):
```toml
[mcp_servers.huly]
command = "npx"
args = ["-y", "@fioenix/huly-mcp@latest"]
[mcp_servers.huly.env]
HULY_HOST = "https://huly.app"
HULY_WORKSPACE_ID = "your-workspace-uuid"
HULY_API_KEY = "your-api-token"
```
MCP tools map 1:1 to CLI commands and return the same `{ "status": ... }` envelope. Templates for every agent: [`examples/agents/`](./examples/agents).

## JSON Mode

Always prefer `--json` for programmatic use. All commands support it:
```bash
huly tasks --assignee me --json
```

Response format:
```json
{ "status": "ok", "data": {...} }
{ "status": "error", "error": "message" }
```

## Command Reference

### Connection & Setup
| Command | Purpose |
|---------|---------|
| `huly whoami` | Verify connection, show account info |
| `huly projects` | List all workspace projects |
| `huly kinds --project <id>` | List task types (kinds) in a project — source of `--kind-id` |
| `huly users [--active-only]` | List workspace people — source of `--assignee` ids |

### Task Management
| Command | Purpose |
|---------|---------|
| `huly tasks [options]` | Query tasks with filters |
| `huly task <id>` | Get full task details by identifier |
| `huly task-by-id <internalId>` | Get task by internal _id (e.g. from childInfo) |
| `huly sub-issues <id>` | Recursive sub-issue tree of a parent task |
| `huly activity <id>` | Activity timeline (changes + comments) |
| `huly create task <title> --project <id> [options]` | Create a new task |
| `huly create task <title> --project <id> --parent <id>` | Create it as a sub-issue of an existing task |
| `huly update task <id> [options]` | Update task fields |
| `huly delete task <id> --yes` | Permanently delete a task |

#### Task Query Filters
- `--assignee me` — current user's tasks
- `--assignee <name>` — by person name
- `--project <identifier>` — by project (e.g., DELTA)
- `--status "In Progress"` — by status name (comma-separated)
- `--overdue` — overdue tasks only
- `--due-today` — due today only
- `--parent <id>` — direct children of a parent task (identifier or internal _id)
- `--milestone-id <id>` — only tasks attached to a milestone

#### Create Task Options
- `--project <id>` — **required**, project identifier
- `--priority <level>` — 0-4 or LOW/MEDIUM/HIGH/URGENT (default: 2)
- `--due <date>` — YYYY-MM-DD, "today", "tomorrow"
- `--assignee <person>` — name, ID, or "me"
- `--parent <id>` — parent task identifier (e.g. OMEGA-588); creates a sub-issue in the same project
- `--kind-id <id>` — task type, from `huly kinds --project <id>`
- `--component-id <id>` — component
- `--milestone-id <id>` — milestone
- `--set-field "key=value"` — custom fields (repeatable)

#### Creating sub-issues
There is no separate "create subtask" command — a sub-issue is a task created
with `--parent`. Do not try to create the task first and re-parent it
afterwards; nothing re-parents an existing task.

```bash
huly create task "Wire up the aggregation job" --project OMEGA --parent OMEGA-588
```

- `--parent` takes the friendly identifier (`OMEGA-588`) or the internal `_id`.
- The parent must be in the same project; a cross-project parent is rejected.
- Nesting deeper than one level is allowed — pass the direct parent, and the
  full ancestor chain is recorded automatically.
- Read the result back with `huly sub-issues <parent>` (tree) or
  `huly tasks --parent <parent>` (direct children only).

#### Choosing an assignee
`--assignee` accepts a name, an internal `_id`, or `me`. When the name is
ambiguous or unknown, list people first rather than guessing:

```bash
huly users --active-only --json
```

`me` resolves to `HULY_ACTOR` when it is set, otherwise to the account behind
`HULY_API_KEY`. On a shared token with no `HULY_ACTOR`, `me` is the token's
owner rather than the person typing — pass an explicit name or `_id` then.

`huly whoami` prints both, so run it when an assignment lands on the wrong
person.

#### Update Task Options
- `--status <name>` — new status
- `--priority <level>` — new priority
- `--due <date>` — new due date
- `--assignee <person>` — new assignee
- `--add-comment <text>` — append a comment
- `--description-file <path>` — replace description from .md/.txt file
- `--kind-id`, `--component-id`, `--milestone-id` — update references
- `--set-field "key=value"` — update custom fields

### Comments
| Command | Purpose |
|---------|---------|
| `huly comments list <objectId> [--class <c>] [--limit <n>]` | List comments on any object by internal _id (issue, milestone, doc, …); thread replies nested in `replies` |
| `huly comments get <messageId>` | Get one comment by its `_id` (the `message` param in a chunter link) |

- `--class` accepts a friendly alias (`issue`/`milestone`/`component`/`project`/`document`) or a raw ref (`tracker:class:Milestone`); omit to match any class on that `_id`.
- For comments on an issue, `huly activity <identifier>` is friendlier (takes `LAMBD-568`, merges changes + comments).

**Resolving a link → comments.** Extract ids from the URL, never call `milestones list`/`tasks` to re-find an id the URL already has. URL-decode (`%7C`→`|`, `%3A`→`:`). The object is the `<24-hex>` next to a `<plugin>:class:<Name>` token; that hex is `<objectId>`, the token is `--class`. A `?message=<id>` param is a specific comment.
- Chunter link `…/chunter/<id>|<class>?message=<msgId>` → `comments get <msgId>`.
- Tracker milestone link `…/tracker/<projectId>/milestones#…|<id>|tracker:class:Milestone|…` → `comments list <id> --class milestone` (the `<projectId>` early in the path is **not** the milestone).
- Token-optimal: prefer `comments get <msgId>` over listing when a `message=` id exists; always `--json`; add `--limit` for "latest few"; bodies come back as markdown — no re-fetch.

### Reports
| Command | Purpose |
|---------|---------|
| `huly report daily --assignee me` | Due today + overdue summary |
| `huly report weekly` | Due this week + overdue summary |

### Labels / Tags
| Command | Purpose |
|---------|---------|
| `huly labels list` | List all workspace labels |
| `huly labels create <title> [--color N]` | Create a new label |
| `huly labels assign <taskId> <labelId>` | Assign label to a task |
| `huly labels show <taskId>` | Show labels on a task |

### Documents
| Command | Purpose |
|---------|---------|
| `huly docs teamspaces` | List all teamspaces |
| `huly docs list <teamspace>` | List documents in a teamspace |
| `huly docs read <teamspace> <title>` | Read document content as markdown |
| `huly docs create <title> -t <teamspace>` | Create a document |
| `huly docs create-teamspace <name>` | Create a new teamspace |

#### Document Create Options
- `-t, --teamspace <name>` — **required**, teamspace name or ID
- `-c, --content <markdown>` — inline markdown content
- `-f, --file <path>` — read content from a file

#### Teamspace Create Options
- `-d, --description <text>` — teamspace description
- `--private` — make teamspace private

### Milestones
| Command | Purpose |
|---------|---------|
| `huly milestones list --project <id>` | List milestones in a project |
| `huly milestones create <label> --project <id>` | Create a milestone |
| `huly milestones complete <milestoneId> --project <id>` | Mark milestone completed |
| `huly milestones report <milestoneId>` | Issues grouped by Epic with recursive sub-issue trees |

#### Milestone Create Options
- `--project <id>` — **required**, project identifier
- `--target <date>` — target date (default: 2 weeks from now)

## Error Handling

Errors appear in Vietnamese with prefix `Loi:`. Parse and relay the message to the user. Never call Huly API routes directly — the CLI is the single source of truth.

## Common Workflows

**"What's on my plate today?"**
```bash
huly report daily --assignee me --json
```

**"Create a task and assign it to me"**
```bash
huly create task "Fix login bug" --project DELTA --priority HIGH --due today --assignee me --json
```

**"Move task to Done and add a comment"**
```bash
huly update task DELTA-42 --status Done --add-comment "Completed and tested" --json
```

**"Tag an issue with a label"**
```bash
huly labels create "critical" --color 4 --json
huly labels assign DELTA-42 <returned-label-id> --json
```
