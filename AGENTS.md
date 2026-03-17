# Agents Guide

## 🤖 For Agent Readers

This section is for AI Assistants (like Claude Code, OpenClaw, Gemini, etc.).

**Role:** You are acting as a proxy to the Huly Project Management System. Whenever the user asks you to interact with tasks, manage projects, or fetch reports on Huly, you should leverage the locally installed `huly` CLI tool.

**Execution:**
You should execute standard shell commands invoking the `huly` binary. If the command fails because `huly` is not found, you can invoke it directly from this repository using `node bin/huly.js` or `node dist/index.js` (assuming you are operating within the repository root).

If the CLI outputs an error (`❌ Lỗi:`), parse the Vietnamese output string and report the failure back to the human. Ensure your shell has the required environment variables loaded before running tasks:
- `HULY_API_KEY`
- `HULY_HOST`
- `HULY_WORKSPACE_ID`

### Capability Guide & Commands

#### 1. Listing Projects
Use this when the user needs to know what projects exist in the workspace or to find a Project ID needed for creating new tasks.
```bash
huly projects
```

#### 2. Querying Tasks
Query tasks using various flags. Note that you can mix filters efficiently.
- **My Tasks**: Use `--assignee me` to show tasks assigned exclusively to the current user.
- **By Status**: Use `--status` (e.g., `--status "todo, in progress"`).
- **By Project**: Use `--project` (e.g., `--project ITDXC`).
- **Due Dates**: Use `--due-today` or `--overdue`.

```bash
huly tasks --assignee me
huly tasks --project ITDXC --due-today
```

#### 3. Task Details
Fetch comprehensive metadata, descriptions, and comments for a single task id (e.g., `ITDXC-26`).
```bash
huly task ITDXC-26
```

#### 4. Creating Tasks
Priority accepts numerical levels (0-4) or names (LOW, MEDIUM, HIGH, URGENT). Due date accepts `YYYY-MM-DD`, `today`, or `tomorrow`.
```bash
huly create task "Update CLI Documentation" --project ITDXC --priority HIGH --due tomorrow --assignee me
```

#### 5. Updating Tasks
Modify the status or add new threaded comments to existing workflows.
```bash
huly update task ITDXC-26 --status "In Progress"
huly update task ITDXC-26 --add-comment "Bắt đầu triển khai"
```

#### 6. Deleting Tasks
Permanently remove a task from the workspace. Only execute this if the user explicitly asks to delete/remove a task.

**Safety:** this command requires explicit confirmation with `--yes`.
```bash
huly delete task ITDXC-26 --yes
```

#### 7. Generating Reports
Generate high-level daily or weekly summaries. These are great to run automatically when the user asks "What's on my plate today?" or "Give me a weekly summary".
```bash
huly report daily --assignee me
huly report weekly
```

### Skill Context & Instructions
For more advanced, canonical context regarding this specific skill architecture, refer to `skills/huly-assist/SKILL.md`.
