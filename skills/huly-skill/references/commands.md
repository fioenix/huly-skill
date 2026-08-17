# Command reference

Run as `node <skill-dir>/bin/huly.cjs <command>` (shown below as `huly`). Every
command accepts `--json`.

## Connection

```bash
huly whoami                    # verify connection, show account + effective identity
```

## Projects, task types, people

```bash
huly projects                  # all projects in the workspace
huly kinds --project OMEGA     # task types (kinds) in a project → ids for --kind-id
huly users [--active-only]     # workspace people → ids for --assignee
```

Task types are scoped by project **type**, not by project: the same name (e.g.
`KPI`) can exist under several project types with different ids. Always read the id
from `huly kinds` for the project you are writing to.

`me` resolves to `HULY_ACTOR` when set, otherwise to whoever owns `HULY_API_KEY`.
On a team sharing one token, `HULY_ACTOR` is what makes `me` mean the person
asking; without it `me` is the token owner. Created tasks also get a
`Requested by: <name>` line, because Huly always records the token owner as the
author and a client cannot override that. Treat it as a label, not a permission —
anyone can set `HULY_ACTOR` to any name.

## Tasks

```bash
huly tasks --assignee me                          # my active tasks
huly tasks --project DELTA --status "In Progress" # filter by project + status
huly tasks --overdue                              # overdue only
huly tasks --due-today                            # due today only
huly tasks --parent LAMBD-568                     # direct children of a parent
huly tasks --milestone-id <id>                    # all tasks in a milestone

huly task DELTA-123                               # full details for one task
huly task-by-id <internalId>                      # look up by internal _id

huly sub-issues LAMBD-568                         # sub-issue tree (recursive by default)
huly sub-issues LAMBD-568 --no-recursive          # direct children only
huly sub-issues LAMBD-568 --json --flat           # flat list, JSON

huly activity LAMBD-568                           # activity feed (changes + comments)
huly activity LAMBD-568 --updates-only            # field changes only
huly activity LAMBD-568 --comments-only --json    # comments only, JSON

huly create task "Title" --project DELTA          # create (required: --project)
  --parent DELTA-16                               # create as a sub-issue
  --priority HIGH --due tomorrow --assignee me
  --kind-id <id> --component-id <id>              # task type (see `huly kinds`), component
  --milestone-id <id>
  --set-field "customKey=value"                   # custom fields

huly update task DELTA-123
  --status "Done" --priority URGENT
  --due 2026-04-01 --assignee me
  --add-comment "Progress update"
  --description-file ./spec.md                    # description from a file

huly delete task DELTA-123 --yes                  # destructive; requires --yes
```

`huly tasks` has no result cap yet — filter it. An unfiltered call on a busy
workspace returns hundreds of full task documents.

### Creating a sub-issue

A subtask is just a task created with `--parent`; there is no separate command and
nothing re-parents a task afterwards, so pass `--parent` at creation:

```bash
huly create task "Wire up the aggregation job" --project OMEGA --parent OMEGA-588
```

The parent must live in the same project. Deeper nesting works — pass the direct
parent and the ancestor chain is recorded. Verify with `huly sub-issues <parent>`.

## Comments

Comments work on **any** object — issues, milestones, documents, components. Thread
replies are nested under their parent comment in `replies`.

```bash
huly comments list <objectId>                      # all comments on an object (internal _id)
huly comments list <milestoneId> --class milestone  # issue|milestone|component|project|document, or a raw ref
huly comments list <objectId> --limit 50 --json    # cap count, JSON
huly comments get <messageId>                      # one comment by _id (the `message` param in a chunter link)
```

For comments on an **issue**, prefer `huly activity <identifier>` — it takes the
friendly identifier (e.g. `LAMBD-568`) and merges changes + comments in one call.

### Resolving a pasted Huly link

Users paste UI links, not ids. Extract identifiers **from the link** — never call
`milestones list` or `tasks` to find an id the URL already contains. URL-decode
first: `%7C`→`|`, `%3A`→`:`.

Rule: the object is the `<24-hex-id>` segment sitting next to a
`<plugin>:class:<Name>` token. That hex is `<objectId>`; the class token is
`--class`. A `?message=<id>` query param, when present, is one comment's `_id`.

| Link shape (after decode) | What you have | Run |
|---|---|---|
| `…/chunter/<id>\|<class>?message=<msgId>` | a specific comment | `comments get <msgId>` |
| `…/tracker/<projectId>/milestones#…\|<id>\|tracker:class:Milestone\|…` | the milestone | `comments list <id> --class milestone` |
| any link with `…\|<id>\|<plugin>:class:<Name>\|…`, no `message=` | the object | `comments list <id> --class <Name lowercased, or raw ref>` |

Worked example —
`…/tracker/694cc03d6911b0939c277716/milestones#view:component:EditDoc|6a1e51134b85263b0ae0092e|tracker:class:Milestone|content`
→ milestone `_id` is `6a1e51134b85263b0ae0092e` (the hex next to
`tracker:class:Milestone`; `694cc03d…` is the project — ignore it) →
`huly comments list 6a1e51134b85263b0ae0092e --class milestone --json`.

Comment bodies come back as markdown already — don't re-fetch them.

## Reports

```bash
huly report daily --assignee me    # due today + overdue summary
huly report weekly                 # due this week + overdue summary
huly milestones report <id>        # grouped by Epic with sub-issue trees
```

Prefer these over listing rows whenever the question is "how are we doing".

## Labels / tags

```bash
huly labels list                          # all workspace labels
huly labels create "bug" --color 3
huly labels assign DELTA-123 <labelId>
huly labels show DELTA-123
```

## Documents

```bash
huly docs teamspaces                              # all teamspaces
huly docs list "My Documents"                     # docs in a teamspace
huly docs read "My Documents" "Meeting Notes"     # read as markdown
huly docs create "New Doc" -t "My Documents"
  --content "# Hello" OR --file ./content.md
huly docs create-teamspace "Engineering"
  --description "Team docs" --private
```

## Milestones

```bash
huly milestones list --project DELTA
huly milestones create "Sprint 1" --project DELTA --target 2026-04-15
huly milestones complete <milestoneId> --project DELTA
```

## Priority levels

| Value | English | Vietnamese |
|-------|---------|------------|
| 0 | None | KHONG UU TIEN |
| 1 | Low | THAP |
| 2 | Medium | TRUNG BINH |
| 3 | High | CAO |
| 4 | Urgent | KHAN CAP |

Input accepts a number (0–4), the English name, or the Vietnamese name.

## Date formats

Due dates accept `YYYY-MM-DD`, `today`, `tomorrow`.

## JSON envelope and errors

```json
{ "status": "ok", "count": 12, "data": [] }
{ "status": "ok", "type": "weekly", "due": [], "overdue": [], "inProgress": 3 }
{ "status": "error", "error": "message" }
```

Listings wrap rows in `data` with a `count`. Reports (`report daily|weekly`) put
their payload at the top level — there is no `data` key. Check the shape before
writing a `jq` path.

Errors print in Vietnamese with a `Loi:` prefix. Parse the message, report the
failure, and don't fall back to calling Huly APIs directly.
