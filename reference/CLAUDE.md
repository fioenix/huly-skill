# Original Specification (Historical Reference)

This file preserves the original requirements spec used to build huly-assist. It is kept for historical context and is not part of the public skill interface.

## Context

Build an agent skill named `huly-assist` that enables AI agents to query, create, update, and analyze tasks/projects in Huly.

## System Info

- **Auth:** JWT token via `HULY_API_KEY` environment variable
- **API Client:** `@hcengineering/api-client` (WebSocket + REST)
- **Language:** TypeScript (Node.js 20+)

## Requirements

### P0 — MVP

1. **Huly Client Wrapper** (`src/client.ts`)
   - Connect using token auth
   - Methods: `connect()`, `disconnect()`, `queryTasks()`, `getTask()`, `createTask()`, `updateTask()`
   - Error handling
   - Proper TypeScript types

2. **CLI Commands** (`src/commands/`)
   - `tasks` — List tasks with filters (assignee, status, project, overdue, due date)
   - `task <id>` — Get task details
   - `create task <title>` — Create new task
   - `update task <id>` — Update task fields
   - `report daily|weekly` — Generate reports

3. **SKILL.md** — Skill definition for agent frameworks

### P1 — Extended Features (Implemented)

4. **Projects Command** — List and query projects
5. **Comments** — Add comments on tasks
6. **Labels/Tags** — Create, assign, list labels
7. **Documents** — CRUD documents and teamspaces
8. **Milestones** — Create, list, complete milestones
9. **Delete** — Delete tasks with safety confirmation
10. **JSON Mode** — Structured output for agent consumption

## Output Format

- **Language:** Vietnamese (for user-facing output)
- **JSON Mode:** Structured `{ status, data }` for agents
- **Max length:** 2500 chars (split if longer)

## Security Requirements

- Token from `HULY_API_KEY` env var only
- Never log full token (show first/last 4 chars only)
- Never commit `.env` or tokens to git
- File access validation for `--description-file`
- Delete requires explicit `--yes` flag

## References

- **Huly Examples:** https://github.com/hcengineering/huly-examples
- **API Client:** https://github.com/hcengineering/huly.core/tree/main/packages/api-client
