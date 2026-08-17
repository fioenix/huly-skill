---
name: huly-skill
description: "Manages tasks, projects, labels, documents, milestones, and contacts in Huly project management. Use when the user asks to list tasks, create issues, update status, check what's overdue, generate daily/weekly reports, manage labels/tags, create or read documents, work with milestones, or read comments/activity (on issues, milestones, or any object — including thread replies) in Huly. Supports both human-readable Vietnamese output and structured JSON mode for programmatic agent use."
license: MIT
compatibility: "Node.js 20+. Requires environment variables: HULY_HOST, HULY_WORKSPACE_ID, HULY_API_KEY. Zero-install: all dependencies are bundled."
metadata:
  author: fioenix
  version: "1.4.0"
  repository: https://github.com/fioenix/huly-skill
---

# Huly Skill

Interact with a Huly project management workspace via the `huly` CLI.

This is a file-based skill loaded by **Claude** (`.claude/skills/huly-skill/`, or `npx skills add fioenix/huly-skill`) and **Google Antigravity** (`<project>/.agents/skills/huly-skill/`). **Codex** has no skill system — it uses [`AGENTS.md`](../../AGENTS.md) + the `@fioenix/huly-mcp` MCP server, which exposes the same operations as `huly_*` tools. Per-agent MCP config templates: [`examples/agents/`](../../examples/agents).

## Setup

The CLI reads 3 environment variables from a `.env` file (it never needs them passed inline):

- `HULY_HOST` — Huly instance URL, e.g. `https://huly.app`
- `HULY_WORKSPACE_ID` — workspace UUID (Huly Settings → Workspace)
- `HULY_API_KEY` — API token (Huly Settings → API Tokens)

It searches for `.env` in this order, first match wins:

1. `~/.huly/.env` — primary; works everywhere and survives the Cowork sandbox
2. Skill directory (next to this SKILL.md) — fallback for Claude Desktop / direct install
3. Working directory

Before running any command, check that `~/.huly/.env` exists with all 3 vars. If it does, go straight to Execution. If not, ask the user for the 3 values and write them:

```bash
mkdir -p ~/.huly
cat > ~/.huly/.env << 'ENVEOF'
HULY_HOST=https://huly.app
HULY_WORKSPACE_ID=<uuid>
HULY_API_KEY=<token>
ENVEOF
```

Write credentials to `.env` rather than passing them inline on the command line: inline values are visible to anything that can read the process list (`ps aux`) and don't persist across sessions. `~/.huly/` is the right home because it stays writable even when the skill directory is read-only.

## Execution

`bin/huly.cjs` sits in the same directory as this SKILL.md. Run:

```bash
node <skill-dir>/bin/huly.cjs <command> [args]
```

Verify the connection first with `node <skill-dir>/bin/huly.cjs whoami`. If the binary is missing the install is incomplete — ask the user to reinstall from https://github.com/fioenix/huly-skill

Every command accepts `--json` for structured output; prefer it for programmatic use.

## Running in the Claude Cowork sandbox

The Cowork sandbox routes network traffic through a local proxy and wipes its filesystem when the session ends. Two adjustments cover both:

**Proxy** — export it once per session so the CLI routes through it:

```bash
export HTTPS_PROXY=http://127.0.0.1:3128
```

The CLI detects `HTTPS_PROXY` and patches both `fetch` and the WebSocket connection to use it. Don't rely on `NODE_USE_ENV_PROXY` — Node still does a local DNS lookup that fails inside the sandbox.

**Persisting credentials** — because the sandbox filesystem is ephemeral, `~/.huly/.env` must live on a directory mounted from the user's machine, or the credentials vanish with the session. Before the first command, mount `~/.huly` with the Cowork directory tool (`mcp__ccd_directory__request_directory`), wait for confirmation, then check or create `.env` there exactly as in Setup. Once mounted, later sessions only need to re-mount — the credentials are already saved.

> For heavy Cowork use, the Huly MCP server is a smoother fit than this CLI skill: its HTTP transport runs outside the sandbox, so there is no proxy to fight and no directory to mount. See the repo README for MCP setup. This skill remains the zero-install option for Claude Code and Claude Desktop.

## Commands

### Connection
```bash
huly whoami                    # Verify connection + show account info
```

### Projects
```bash
huly projects                  # List all projects in the workspace
huly kinds --project OMEGA     # Task types (kinds) in a project → IDs for --kind-id
```

Task types are scoped by project type, not by project: the same name (e.g. `KPI`)
can exist under several project types with different IDs. Always read the ID from
`huly kinds` for the project you are writing to.

### Tasks
```bash
huly tasks --assignee me                          # My active tasks
huly tasks --project DELTA --status "In Progress" # Filter by project + status
huly tasks --overdue                              # Overdue tasks only
huly tasks --due-today                            # Due today only
huly tasks --parent LAMBD-568                     # Direct children of a parent task
huly tasks --milestone-id <id>                    # All tasks in a milestone

huly task DELTA-123                               # Full details for one task
huly task-by-id <internalId>                      # Look up by internal _id (not identifier)

huly sub-issues LAMBD-568                         # Sub-issue tree (recursive by default)
huly sub-issues LAMBD-568 --no-recursive          # Direct children only
huly sub-issues LAMBD-568 --json --flat           # Flat list, JSON output

huly activity LAMBD-568                           # Activity feed (changes + comments)
huly activity LAMBD-568 --updates-only            # Field changes only
huly activity LAMBD-568 --comments-only --json    # Comments only, JSON

huly create task "Title" --project DELTA          # Create task (required: --project)
  --priority HIGH --due tomorrow --assignee me    # Optional: priority, due date, assignee
  --kind-id <id> --component-id <id>              # Optional: task type (see `huly kinds`), component
  --milestone-id <id>                             # Optional: milestone
  --set-field "customKey=value"                   # Optional: custom fields

huly update task DELTA-123                        # Update task
  --status "Done" --priority URGENT               # Change status/priority
  --due 2026-04-01 --assignee me                  # Change due date/assignee
  --add-comment "Progress update"                 # Add comment
  --description-file ./spec.md                    # Set description from file

huly delete task DELTA-123 --yes                  # Delete (requires --yes)
```

### Comments
Read comments on **any** object — issues, milestones, documents, components — not just issues. Thread replies are nested under their parent comment in `replies`.

```bash
huly comments list <objectId>                     # All comments on an object (by internal _id)
huly comments list <milestoneId> --class milestone # Filter by parent class (issue|milestone|component|project|document or a raw ref)
huly comments list <objectId> --limit 50 --json   # Cap count, JSON output
huly comments get <messageId>                      # One comment by its _id (the "message" param in a chunter link)
```

- For comments on an **issue**, prefer `huly activity <identifier>` — it accepts the friendly identifier (e.g. `LAMBD-568`) and merges changes + comments in one call.

#### Resolving a Huly link → comments (do this, don't guess)

The user usually pastes a UI link, not an `_id`. Extract identifiers **from the link itself** — never call `milestones list` / `tasks` to "find" an id that the URL already contains (wasted round-trip + tokens). URL-decode first: `%7C`→`|`, `%3A`→`:`.

**Rule:** the object is the `<24-hex-id>` segment sitting next to a `<plugin>:class:<Name>` token. That hex is `<objectId>`; the class token is `--class`. A `?message=<id>` query param, when present, is a specific comment's `_id`.

| Link shape (after decode) | What you have | Run |
|---|---|---|
| `…/chunter/<id>\|<class>?message=<msgId>` | a specific comment | `comments get <msgId>` |
| `…/tracker/<projectId>/milestones#…\|<id>\|tracker:class:Milestone\|…` | the milestone, no comment id | `comments list <id> --class milestone` |
| any link with `…\|<id>\|<plugin>:class:<Name>\|…` and no `message=` | the object, no comment id | `comments list <id> --class <Name lowercased, or raw ref>` |

Worked example — `…/tracker/694cc03d6911b0939c277716/milestones#view:component:EditDoc|6a1e51134b85263b0ae0092e|tracker:class:Milestone|content` → milestone `_id` is `6a1e51134b85263b0ae0092e` (the hex next to `tracker:class:Milestone`; `694cc03d…` is the project, ignore it) → `huly comments list 6a1e51134b85263b0ae0092e --class milestone --json`.

**Token-optimal defaults:** always pass `--json`; use `comments get <msgId>` (one comment) whenever a `message=` id exists instead of listing a whole thread; add `--limit` when you only need the latest few. Comment bodies are returned as markdown already — don't re-fetch them.

### Reports
```bash
huly report daily --assignee me    # Tasks due today + overdue summary
huly report weekly                 # Tasks due this week + overdue summary
```

### Labels / Tags
```bash
huly labels list                                  # List all workspace labels
huly labels create "bug" --color 3                # Create a label
huly labels assign DELTA-123 <labelId>            # Assign label to issue
huly labels show DELTA-123                        # Show labels on an issue
```

### Documents
```bash
huly docs teamspaces                              # List all teamspaces
huly docs list "My Documents"                     # List docs in a teamspace
huly docs read "My Documents" "Meeting Notes"     # Read doc as markdown
huly docs create "New Doc" -t "My Documents"      # Create document
  --content "# Hello" OR --file ./content.md      # Content: inline or file
huly docs create-teamspace "Engineering"           # Create new teamspace
  --description "Team docs" --private              # Optional: description, private
```

### Milestones
```bash
huly milestones list --project DELTA                   # List project milestones
huly milestones create "Sprint 1" --project DELTA      # Create milestone
  --target 2026-04-15                                  # Optional: target date
huly milestones complete <milestoneId> --project DELTA # Mark as completed
huly milestones report <milestoneId>                   # Report grouped by Epic with sub-issue trees
```

## JSON Mode

Append `--json` to any command for structured output. All JSON responses follow:
```json
{ "status": "ok", "data": {...} }
{ "status": "error", "error": "message" }
```

## Error Handling

Errors display in Vietnamese (prefix `Loi:`). Parse the message and report failure to the user. Do not attempt to call Huly API routes directly — always use the CLI as the source of truth.

## Priority Levels

| Value | English | Vietnamese |
|-------|---------|------------|
| 0 | None | KHONG UU TIEN |
| 1 | Low | THAP |
| 2 | Medium | TRUNG BINH |
| 3 | High | CAO |
| 4 | Urgent | KHAN CAP |

Input accepts: number (0-4), English name, or Vietnamese name.

## Date Formats

Due dates accept: `YYYY-MM-DD`, `today`, `tomorrow`.
