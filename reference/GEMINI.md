# CLAUDE.md — Huly Assist Skill Implementation

## Context

Build a OpenClaw skill named `huly-assist` that enables FINOBOT to query, create, update, and analyze tasks/projects in Huly (Yody's self-hosted project management system).

## System Info

- **Huly Host:** <your-huly-host>
- **Auth:** JWT token via `HULY_API_KEY` environment variable
- **API Client:** `@hcengineering/api-client` (WebSocket + REST)
- **Workspace ID:** `<your-workspace-id>`
- **Language:** TypeScript (Node.js 20+)

## Requirements

### P0 — MVP (Must Implement)

1. **Huly Client Wrapper** (`src/client.ts`)
   - Connect using token auth
   - Methods: `connect()`, `disconnect()`, `queryTasks()`, `getTask()`, `createTask()`, `updateTask()`
   - Error handling with retry logic
   - Proper TypeScript types from `@hcengineering/api-client`

2. **CLI Commands** (`src/commands/`)
   - `tasks` — List tasks with filters (assignee, status, project, overdue, due date)
   - `task <id>` — Get task details
   - `create task <title>` — Create new task
   - `update task <id>` — Update task fields
   - `report daily|weekly` — Generate reports

3. **Entry Point** (`scripts/huly.sh`)
   - Bash wrapper to call CLI
   - Load env vars from `~/.openclaw/.env`
   - Handle errors gracefully

4. **SKILL.md** — Skill definition for OpenClaw
   - Name: `huly-assist`
   - Description, installation, usage examples
   - Environment requirements

### P1 — Should Implement (If Time Permits)

5. **Projects Command** — List and query projects
6. **Comments** — Add/list comments on tasks
7. **Export** — Export tasks to JSON/CSV

## Technical Specifications

### Project Structure

```
huly-assist/
├── SKILL.md
├── package.json
├── tsconfig.json
├── scripts/
│   └── huly.sh
├── src/
│   ├── index.ts
│   ├── client.ts
│   ├── commands/
│   │   ├── tasks.ts
│   │   ├── create.ts
│   │   ├── update.ts
│   │   └── report.ts
│   └── utils/
│       ├── auth.ts
│       └── logger.ts
└── README.md
```

### Connection Example

```typescript
import { connect } from '@hcengineering/api-client'

const client = await connect(process.env.HULY_HOST, {
  token: process.env.HULY_API_KEY,
  workspace: process.env.HULY_WORKSPACE_ID
})

// Query tasks
const tasks = await client.findAll(task.class.Task, {
  assignee: 'person-id',
  status: { $in: ['todo', 'in_progress'] }
})

await client.close()
```

### CLI Interface

```bash
# List tasks
huly tasks --assignee me --status todo,in_progress
huly tasks --overdue
huly tasks --due today

# Task details
huly task TASK-123

# Create task
huly create task "Fix login bug" --project PROJ-456 --priority high --due 2026-03-10

# Update task
huly update task TASK-123 --status done
huly update task TASK-123 --add-comment "Fixed in PR #789"

# Reports
huly report daily --assignee me
huly report weekly
```

### Output Format

- **Language:** Vietnamese (for user-facing output)
- **Format:** Plain text with emojis (Telegram-friendly)
- **Max length:** 2500 chars (split if longer)

Example:
```
📋 TASKS DUE TODAY - 05/03/2026

⏰ Due Today (3)
• [HIGH] Fix login bug — @Fio — Project: Auth
• [MEDIUM] Review PR #456 — @Fio — Project: Core
• [LOW] Update docs — @John — Project: Docs

🚨 Overdue (1)
• [HIGH] Deploy v2.1 — @Fio (2 days late)

📊 Summary: 3 due today | 1 overdue | 5 in progress
```

## Security Requirements

- ✅ Token from `HULY_API_KEY` env var only
- ✅ Never log full token (show first/last 4 chars only)
- ✅ Never commit `.env` or tokens to git
- ✅ Handle API errors without exposing internals
- ✅ Rate limiting: max 10 requests/minute

## Testing Requirements

1. **Unit Tests**
   - Client connection/disconnection
   - Command argument parsing
   - Report formatting

2. **Integration Tests**
   - Connect to Huly (use test token)
   - Query existing tasks
   - Create → Update → Verify task
   - Clean up test data

3. **Manual Testing Checklist**
   - [ ] `huly tasks --assignee me` returns correct tasks
   - [ ] `huly task <id>` shows full details
   - [ ] `huly create task` creates task in Huly
   - [ ] `huly update task` updates status correctly
   - [ ] `huly report daily` generates readable report
   - [ ] Error handling (invalid token, network error)

## Deliverables

1. ✅ Complete TypeScript project in `~/.agents/skills/huly-assist/`
2. ✅ Working CLI with all P0 commands
3. ✅ `SKILL.md` for OpenClaw integration
4. ✅ `README.md` with setup instructions
5. ✅ Test script (`scripts/test.sh`)
6. ✅ Git commit with clear message

## References

- **API Client Docs:** https://github.com/hcengineering/huly.core/tree/main/packages/api-client
- **Platform Repo:** https://github.com/hcengineering/platform
- **Knowledge Base:** `/Users/fioenix/.openclaw/workspace/memory/huly-integration.md`
- **Brainstorm:** `/Users/fioenix/.openclaw/workspace/memory/huly-skill-brainstorm.md`

## Success Criteria

- ✅ Can list tasks assigned to current user
- ✅ Can create a new task via CLI
- ✅ Can update task status
- ✅ Daily report generates correctly
- ✅ Response time < 5 seconds for queries
- ✅ Zero security issues (no token leaks)

## Notes for Claude Code

- Start by exploring the Huly API to understand actual class names (`task:class:Task` vs `task:class:Issue`)
- Check what spaces exist in the workspace
- Verify token works before implementing full features
- Use existing patterns from other OpenClaw skills (e.g., `moltbook-interact`)
- Keep code modular and testable
- Document assumptions and decisions in README
