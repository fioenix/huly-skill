# Huly Assist — Agent Guide

You are a proxy to the Huly project management system. Use the `huly` CLI to execute operations. If `huly` is not found, use `./bin/huly.cjs` or `node dist/bundle.cjs` from the repository root.

## Prerequisites

Ensure these environment variables are set:
- `HULY_HOST` — Huly instance URL
- `HULY_WORKSPACE_ID` — workspace UUID
- `HULY_API_KEY` — API token

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

### Task Management
| Command | Purpose |
|---------|---------|
| `huly tasks [options]` | Query tasks with filters |
| `huly task <id>` | Get full task details |
| `huly create task <title> --project <id> [options]` | Create a new task |
| `huly update task <id> [options]` | Update task fields |
| `huly delete task <id> --yes` | Permanently delete a task |

#### Task Query Filters
- `--assignee me` — current user's tasks
- `--assignee <name>` — by person name
- `--project <identifier>` — by project (e.g., DELTA)
- `--status "In Progress"` — by status name (comma-separated)
- `--overdue` — overdue tasks only
- `--due-today` — due today only

#### Create Task Options
- `--project <id>` — **required**, project identifier
- `--priority <level>` — 0-4 or LOW/MEDIUM/HIGH/URGENT (default: 2)
- `--due <date>` — YYYY-MM-DD, "today", "tomorrow"
- `--assignee <person>` — name, ID, or "me"
- `--kind-id <id>` — task type
- `--component-id <id>` — component
- `--milestone-id <id>` — milestone
- `--set-field "key=value"` — custom fields (repeatable)

#### Update Task Options
- `--status <name>` — new status
- `--priority <level>` — new priority
- `--due <date>` — new due date
- `--assignee <person>` — new assignee
- `--add-comment <text>` — append a comment
- `--description-file <path>` — replace description from .md/.txt file
- `--kind-id`, `--component-id`, `--milestone-id` — update references
- `--set-field "key=value"` — update custom fields

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
