# Huly Assist

A CLI tool and [agent skill](https://agentskills.io) for managing tasks, projects, labels, documents, and milestones in [Huly](https://huly.io) — built on the official [`@hcengineering/api-client`](https://github.com/hcengineering/huly-examples).

Works with Claude Code, Cursor, OpenCode, and any agent supporting the [Agent Skills](https://github.com/vercel-labs/skills) ecosystem.

## Install as Agent Skill

```bash
npx skills add fioenix/huly-skill
```

Or manually:
```bash
git clone https://github.com/fioenix/huly-skill.git
cd huly-skill
npm install
npm run build
```

## Setup

### 1. Environment Variables

Set these before using any command:

```bash
export HULY_HOST="https://huly.app"
export HULY_WORKSPACE_ID="your-workspace-uuid"
export HULY_API_KEY="your-api-token"
```

- **HULY_HOST**: Your Huly instance URL
- **HULY_WORKSPACE_ID**: Found in Huly Settings > Workspace
- **HULY_API_KEY**: Create at Huly Settings > API Tokens

### 2. GitHub Packages Registry

The `@hcengineering/api-client` package is hosted on GitHub Packages. You need a GitHub Personal Access Token with `read:packages` scope:

```bash
# Create .npmrc in project root (or ~/.npmrc for global)
echo "@hcengineering:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT" >> .npmrc
```

Create a PAT at: https://github.com/settings/tokens/new (select `read:packages` scope)

### 3. Verify

```bash
node dist/index.js whoami
```

## Usage

### Tasks
```bash
huly tasks --assignee me              # My tasks
huly tasks --project DELTA --overdue  # Overdue in project
huly task DELTA-123                   # Task details
huly create task "Title" --project DELTA --priority HIGH --due tomorrow
huly update task DELTA-123 --status "Done" --add-comment "Completed"
huly delete task DELTA-123 --yes      # Requires confirmation
```

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
```

### JSON Mode

Append `--json` to any command for structured output:
```bash
huly tasks --assignee me --json
```

## For AI Agents

See [AGENTS.md](./AGENTS.md) for the full agent integration guide, or [skills/huly-assist/SKILL.md](./skills/huly-assist/SKILL.md) for the skill definition.

## Technical Notes

The `@hcengineering/api-client` expects browser APIs (`indexedDB`, `window`). This project polyfills them in `src/index.ts` using `fake-indexeddb` — no browser required.

## License

MIT
