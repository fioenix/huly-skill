# Huly Assist Skill - Current State

**Last Updated:** 2026-03-05 15:30

## Summary

Building a `huly-assist` skill for OpenClaw that enables querying, creating, and updating tasks in Huly.

---

## Completed Work

### 1. API Exploration ✅
- Successfully connected to Huly API
- Confirmed class names:
  - **Issue/Task:** `tracker:class:Issue`
  - **Project:** `tracker:class:Project`
  - **Person:** `contact:class:Person`
- Discovered workspace structure and data model
- Found sample projects: DELTA, DATA_, WEBSI, INFRA, LAMBD, GAMMA, SIGMA

### 2. SKILL.md Drafted ✅
- Created comprehensive skill definition at `/SKILL.md`
- Includes: class names, object structures, example queries, output format
- Vietnamese output format specified
- Error handling and security guidelines included

### 3. Test Cases Created ✅
- Created evals.json with 5 test cases:
  1. `list-my-tasks` - Show tasks due this week
  2. `overdue-tasks` - Show overdue tasks
  3. `create-task` - Create new task in DELTA
  4. `task-details` - Get details for DELTA-1
  5. `daily-report` - Generate daily task report

### 4. Evaluation Runs Completed ✅
- Ran all 5 test cases with both "with skill" and "without skill" variants
- Results saved to `/huly-assist-workspace/iteration-1/`

---

## Key Findings from Evaluation

### Successes
- **overdue-tasks:** Found 212 overdue tasks successfully
- **task-details:** Retrieved full details for DELTA-1
- **create-task:** Created task DELTA-115 in Huly (real task created!)
- **daily-report:** Generated comprehensive daily report

### Issues Found
- **list-my-tasks:** One run had auth error (inconsistent - other runs worked)
- Some status values returned as IDs instead of names (need status mapping)
- Output format varies between runs (not consistently Vietnamese)

### API Insights
- Issues use `addCollection()` not `createDoc()` (AttachedDoc pattern)
- Parent issues attach to `tracker:ids:NoParent` placeholder
- Task identifiers auto-increment per project (DELTA-1, DELTA-2, etc.)

---

## Current File Structure

```
huly-assist/
├── SKILL.md                 # Skill definition ✅
├── CLAUDE.md                # Project requirements
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── .gitignore               # Git ignore rules
├── src/
│   └── explore.ts           # API exploration script
├── evals/
│   └── evals.json           # Test case definitions
├── huly-assist-workspace/
│   └── iteration-1/         # Evaluation results
│       ├── list-my-tasks/
│       ├── overdue-tasks/
│       ├── create-task/
│       ├── task-details/
│       └── daily-report/
└── STATE.md                 # This file
```

---

## Pending Work

### P0 - Must Complete
1. **Review evaluation results** - Open eval viewer and assess outputs
2. **Draft assertions** - Define quantitative success criteria
3. **Iterate on SKILL.md** - Improve based on evaluation feedback
4. **Implement CLI wrapper** - Create `scripts/huly.sh` entry point
5. **Build complete CLI** - Implement all commands in `src/commands/`

### P1 - Should Complete
6. **Status mapping** - Map status IDs to human-readable names
7. **Consistent Vietnamese output** - Ensure all outputs follow format
8. **Error handling** - Better error messages and retry logic
9. **Package skill** - Create `.skill` file for OpenClaw

---

## How to Continue

### Step 1: Review Evaluation Results
```bash
# View outputs
cat huly-assist-workspace/iteration-1/overdue-tasks/without_skill/outputs/overdue-tasks-summary.md
cat huly-assist-workspace/iteration-1/task-details/with_skill/outputs/task-details.txt
cat huly-assist-workspace/iteration-1/create-task/with_skill/outputs/create-task-result.txt
```

### Step 2: Generate Eval Viewer
```bash
# From skill-creator directory
python -m scripts.aggregate_benchmark huly-assist-workspace/iteration-1 --skill-name huly-assist

python <skill-creator-path>/eval-viewer/generate_review.py \
  huly-assist-workspace/iteration-1 \
  --skill-name "huly-assist" \
  --benchmark huly-assist-workspace/iteration-1/benchmark.json
```

### Step 3: Implement CLI
Create the actual CLI commands in `src/commands/`:
- `tasks.ts` - List tasks with filters
- `task.ts` - Get task details
- `create.ts` - Create new task
- `update.ts` - Update task
- `report.ts` - Generate reports

### Step 4: Create Entry Point
```bash
# scripts/huly.sh
#!/bin/bash
source ~/.openclaw/.env
export HULY_API_KEY
node /path/to/dist/index.js "$@"
```

---

## Environment Setup

The Huly API key is stored in:
```
~/.openclaw/.env
```

Current workspace:
- **Host:** <your-huly-host>
- **Workspace ID:** <your-workspace-id>
- **Account:** <your-account>

---

## Notes for Next Session

1. A real task **DELTA-115** was created during testing - consider deleting it
2. Some evaluation runs created helper scripts in `src/` - these can be reused
3. The skill worked well for querying, but output format needs standardization
4. Consider adding status/priority name mapping for better readability

---

## References

- **API Client Docs:** https://github.com/hcengineering/huly.core/tree/main/packages/api-client
- **Platform Repo:** https://github.com/hcengineering/platform
- **Skill Creator:** `/Users/fioenix/.claude/skills/skill-creator/`