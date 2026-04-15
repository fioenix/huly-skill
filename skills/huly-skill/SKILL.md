---
name: huly-skill
description: "Manages tasks, projects, labels, documents, milestones, and contacts in Huly project management. Use when the user asks to list tasks, create issues, update status, check what's overdue, generate daily/weekly reports, manage labels/tags, create or read documents, or work with milestones in Huly. Supports both human-readable Vietnamese output and structured JSON mode for programmatic agent use."
license: MIT
compatibility: "Node.js 20+. Requires environment variables: HULY_HOST, HULY_WORKSPACE_ID, HULY_API_KEY. Zero-install: all dependencies are bundled."
metadata:
  author: fioenix
  version: "1.1.0"
  repository: https://github.com/fioenix/huly-skill
---

# Huly Skill

Interact with a Huly project management workspace via the `huly` CLI.

## Setup (first-time) — MANDATORY

The CLI needs 3 environment variables. It auto-loads them from a `.env` file, searching these locations in order:
1. Skill directory (same dir as this SKILL.md) — works in Claude Desktop / direct install
2. `~/.huly/.env` — writable in Cowork sandbox (skill dir is read-only)
3. Working directory

**CRITICAL: You MUST persist credentials to `.env`. NEVER pass env vars inline in commands.** Inline env vars expose secrets in process argument lists and don't persist across sessions.

**Check if `.env` exists** before every command:
- Check skill directory first, then `~/.huly/.env`
- If `.env` exists and contains all 3 vars → proceed to run the command
- If `.env` is missing or incomplete → run the setup flow below

**Setup flow (only when `.env` is missing):**
1. Ask the user for these 3 values:
   - `HULY_HOST` — Huly instance URL (e.g. `https://huly.app`)
   - `HULY_WORKSPACE_ID` — workspace UUID (Huly Settings → Workspace)
   - `HULY_API_KEY` — API token (Huly Settings → API Tokens)
2. **Write a `.env` file.** Try the skill directory first. If it's read-only (Cowork sandbox), write to `~/.huly/.env` instead:
   ```bash
   mkdir -p ~/.huly
   ```
   ```
   HULY_HOST=https://huly.app
   HULY_WORKSPACE_ID=<uuid>
   HULY_API_KEY=<token>
   ```
3. Verify: run `node <skill-dir>/bin/huly.cjs whoami` (no inline env vars needed — the CLI reads `.env` automatically)

**Security:** The `.env` file stays local on disk. This is safer than passing secrets as command-line arguments (visible via `ps aux`).

## Execution

**Binary location:** `bin/huly.cjs` is in the same directory as this SKILL.md file.

For example, if this file is at `/path/to/huly-skill/SKILL.md`, run `node /path/to/huly-skill/bin/huly.cjs`.

```bash
node <skill-dir>/bin/huly.cjs <command> [args]
```

If the binary is missing, inform the user to reinstall the skill from https://github.com/fioenix/huly-skill

All commands support `--json` for structured JSON output (preferred for programmatic agent use).

## Cowork Sandbox Compatibility

This skill is compatible with Claude Cowork.

**Network proxy:** Cowork sandbox routes all traffic through `127.0.0.1:3128`. You MUST set `HTTPS_PROXY` before running any command:
```bash
export HTTPS_PROXY=http://127.0.0.1:3128
```
The CLI detects `HTTPS_PROXY` and patches both fetch (via `undici.ProxyAgent`) and WebSocket (via `https-proxy-agent`) to route through the proxy. Do NOT rely on `NODE_USE_ENV_PROXY` — it still attempts local DNS which fails in sandbox.

**`.env` file location:** The skills directory is read-only in Cowork. Write your `.env` to `~/.huly/.env` instead:
```bash
mkdir -p ~/.huly
cat > ~/.huly/.env << 'ENVEOF'
HULY_HOST=https://your-instance.huly.io
HULY_WORKSPACE_ID=<uuid>
HULY_API_KEY=<token>
ENVEOF
```

## Commands

### Connection
```bash
huly whoami                    # Verify connection + show account info
```

### Projects
```bash
huly projects                  # List all projects in the workspace
```

### Tasks
```bash
huly tasks --assignee me                          # My active tasks
huly tasks --project DELTA --status "In Progress" # Filter by project + status
huly tasks --overdue                              # Overdue tasks only
huly tasks --due-today                            # Due today only

huly task DELTA-123                               # Full details for one task

huly create task "Title" --project DELTA          # Create task (required: --project)
  --priority HIGH --due tomorrow --assignee me    # Optional: priority, due date, assignee
  --kind-id <id> --component-id <id>              # Optional: task type, component
  --milestone-id <id>                             # Optional: milestone
  --set-field "customKey=value"                   # Optional: custom fields

huly update task DELTA-123                        # Update task
  --status "Done" --priority URGENT               # Change status/priority
  --due 2026-04-01 --assignee me                  # Change due date/assignee
  --add-comment "Progress update"                 # Add comment
  --description-file ./spec.md                    # Set description from file

huly delete task DELTA-123 --yes                  # Delete (requires --yes)
```

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
