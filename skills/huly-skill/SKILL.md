---
name: huly-skill
description: "Manages tasks, projects, labels, documents, milestones, and contacts in Huly project management. Use when the user asks to list tasks, create issues, update status, check what's overdue, generate daily/weekly reports, manage labels/tags, create or read documents, work with milestones, create subtasks under a parent issue, look up workspace people, or read, edit and delete comments/activity (on issues, milestones, or any object — including thread replies) in Huly. Supports both human-readable output and structured JSON mode for programmatic agent use."
license: MIT
compatibility: "Node.js 20.18.1+. Requires environment variables: HULY_HOST, HULY_WORKSPACE_ID, HULY_API_KEY. Zero-install: all dependencies are bundled."
metadata:
  author: fioenix
  version: "1.10.1"
  repository: https://github.com/fioenix/huly-skill
---

# Huly Skill

Read and write a Huly workspace through the bundled CLI at `<skill-dir>/bin/huly.cjs`
(shown below as `huly`). Start with `huly whoami` to confirm credentials and see
which identity your writes will be attributed to; `huly whoami --offline` diagnoses
configuration without a connection.

Credentials live in `~/.huly/.env`, never inline. If it is missing any of
`HULY_HOST`, `HULY_WORKSPACE_ID`, `HULY_API_KEY`, read
[references/setup.md](references/setup.md) first — same for where tokens come from
and for running inside the Cowork sandbox.

## Pick the cheapest path that answers the question

One unfiltered `huly tasks --json` on a real workspace is ~274 KB (~107K tokens),
and a tool result stays in context for the rest of the session. Stop at the first
step that answers the question:

1. **Ask for the answer, not the rows** — `huly report daily|weekly`,
   `huly milestones report <id>` return a computed summary (~13 KB for a full week).
2. **Filter at the source** — `--assignee`, `--project`, `--status`, `--overdue`,
   `--due-today`, `--parent`, `--milestone-id`, then `--limit` and `--fields` to
   cap rows and drop columns you will not read.
3. **Reduce in the shell** — pipe `--json` through `jq`, or stage it in a file and
   print only what you need, so the rows never enter the conversation
   ([references/recipes.md](references/recipes.md)).
4. **Only then list** — and say what you left out.

Always pass `--json` when parsing or piping. Listings return
`{"status":"ok","count":N,"data":[…]}`; reports put their payload at the top level;
failures return `{"status":"error","error":"…","code":"…","retryable":bool}` —
retry only when `retryable` is true.

## Everyday commands

```bash
huly tasks --assignee me --json                  # my active tasks
huly task DELTA-123 --json                       # one task, full detail
huly activity LAMBD-568 --comments-only --json   # comments + changes on an issue
huly create task "Title" --project DELTA --parent DELTA-16 --assignee me
huly update task DELTA-123 --status "Done" --add-comment "shipped"
huly report weekly --json                        # computed weekly summary
```

Everything else — projects, task kinds, users, comments on any object (read, edit, delete), documents,
teamspaces, milestones, labels, priorities, dates, pasted-link resolution:
[references/commands.md](references/commands.md).

## Before you write

- Task kinds are scoped by project **type**: take the id from
  `huly kinds --project <KEY>` for the project you are writing to.
- A subtask is a task created with `--parent`; nothing re-parents it afterwards.
- `me` is `HULY_ACTOR` when set, else the owner of `HULY_API_KEY` — and Huly always
  records that token owner as the author, whatever `HULY_ACTOR` says.
- Deletes need `--yes`. Errors print with an `Error:` prefix; in JSON, `code` and
  `retryable` say whether another attempt can help.
- Never call Huly HTTP/WS APIs directly; the CLI is the source of truth.

Codex has no skill system: it uses [`AGENTS.md`](../../AGENTS.md) with the
`@fioenix/huly-mcp` server, which exposes the same operations as `huly_*` tools.
