---
name: huly-assist
description: "Use this skill whenever the user wants to read, create, update, delete, or generate reports for tasks and projects in Huly. If the user asks to 'list my tasks', 'what's overdue?', 'create a task for...', or 'delete this task' in Huly, use this skill. The skill leverages a dedicated CLI tool to interact directly with the Huly API securely."
---

# Huly Assist Skill

This skill allows you (the AI assistant) to interact with a Huly project management instance.

## Environment Variables

This skill requires the following environment variables:
- `HULY_API_KEY`
- `HULY_HOST`
- `HULY_WORKSPACE_ID`

## Tool Execution

You can perform actions on Huly using the overarching `huly` CLI (if correctly linked globally via `pnpm link --global`). Alternatively, if operating directly within the repository, you can execute `node dist/index.js`. 

*Assume `huly` is available globally in the environment unless you get a command not found error, in which case fallback to `node dist/index.js`.*

### 1. Listing Projects
To see all available projects in the workspace:
```bash
huly projects
```

### 2. Querying Tasks
You can query tasks using various filters.
- **My Tasks**: Use `--assignee me` to show tasks assigned to the current user token.
- **By Status**: Use `--status` (e.g., `--status "todo, in progress"`).
- **By Project**: Use `--project` (e.g., `--project DELTA`).
- **Due Dates**: Use `--due-today` or `--overdue`.

```bash
huly tasks --assignee me
huly tasks --project ITDXC --due-today
```

### 3. Task Details
To view comprehensive metadata for a single task:
```bash
huly task ITDXC-26
```

### 4. Creating Tasks
Priority accepts numerical levels (0-4) or names (LOW, MEDIUM, HIGH, URGENT). Due date accepts `YYYY-MM-DD`, `today`, or `tomorrow`.
```bash
huly create task "Update CLI Documentation" --project ITDXC --priority HIGH --due tomorrow --assignee me
```

### 5. Updating Tasks
You can modify the status or add new comments to existing tasks.
```bash
huly update task ITDXC-26 --status "In Progress"
huly update task ITDXC-26 --add-comment "Bắt đầu triển khai"
```

### 6. Deleting Tasks
To permanently delete a task from the workspace:
```bash
huly delete task ITDXC-26
```

### 7. Generating Reports
Provides structured summaries of what is due or overdue today vs this week.
```bash
huly report daily --assignee me
huly report weekly
```

## Error Handling

If the CLI outputs an error (`❌ Lỗi:`), parse the Vietnamese output string and report the failure back to the human. Ensure your shell has the required environment variables loaded (`HULY_API_KEY`, `HULY_HOST`, `HULY_WORKSPACE_ID`) (if you're using OpenClaw, you can often run `export $(grep -v '^#' ~/.openclaw/.env | xargs)`). Do not attempt to guess or mock the API internal routes; rely purely on the CLI output as your source of truth.
