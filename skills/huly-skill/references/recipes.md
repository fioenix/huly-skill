# Token-lean recipes

Why this file exists: on a real workspace (249 tasks) an unfiltered
`huly tasks --json` is **273,771 bytes ≈ 107K tokens**. The same question answered
through a shell reduction is **2,178 bytes ≈ 850 tokens** — ~125× less — because the
rows are processed outside the conversation. A tool result, by contrast, always
enters context and is resent on every later turn until compaction.

Rule of thumb: if you are going to read only a few fields of a large listing, never
print the listing.

## JSON shapes

- Listings: `{"status":"ok","count":N,"data":[ … ]}` — `data` is the array.
- Reports: `{"status":"ok","type":"weekly","assignee":…,"due":[…],"overdue":[…],"inProgress":N}`
  — payload fields sit at the top level, not under `data`.
- Errors: `{"status":"error","error":"…"}`.

## Reduce in the shell

```bash
# One line per task: identifier + title (drops ~30 unused fields per row)
huly tasks --assignee me --json | jq -r '.data[] | "\(.identifier) \(.title)"'

# Count by status — the answer, not the rows
huly tasks --project BETA --json | jq -r '.data[] | .statusName // .status' | sort | uniq -c | sort -rn

# Overdue, oldest first, top 10 only
huly tasks --overdue --json | jq -r '.data | sort_by(.dueDate)[:10][] | "\(.identifier) \(.dueDate) \(.title)"'

# Who carries what (workload snapshot)
huly tasks --json | jq -r '.data[] | .assignee // "unassigned"' | sort | uniq -c | sort -rn

# Just the number
huly tasks --overdue --json | jq '.count'
```

## Stage on disk, read back a slice

When several reductions run over the same data, fetch once into a file. The file is
not context; only what you print is.

```bash
huly tasks --project BETA --json > /tmp/beta.json
jq '.count' /tmp/beta.json
jq -r '.data[] | select(.priority >= 3) | "\(.identifier) \(.title)"' /tmp/beta.json
```

Same pattern for a report you intend to reshape into a table or a document:

```bash
huly report weekly --json > /tmp/w.json
jq -r '.overdue[] | "\(.identifier) \(.title)"' /tmp/w.json
jq '{inProgress, due: (.due|length), overdue: (.overdue|length)}' /tmp/w.json
```

## Prefer the computed report

For "how are we doing" questions, `huly report weekly --json` is ~13 KB and already
grouped; deriving the same picture from a full task listing costs ~20× more and asks
the model to do arithmetic it can get wrong.

```bash
huly report daily --assignee me --json | jq '{due: (.due|length), overdue: (.overdue|length), inProgress}'
```

## Don't spend calls rediscovering ids

- A pasted Huly URL already contains the object id and class — parse the link
  instead of listing candidates (see the link table in
  [commands.md](commands.md#resolving-a-pasted-huly-link)).
- `?message=<id>` in a link means one specific comment: `huly comments get <id>`
  beats listing a whole thread.
- `huly kinds --project <KEY>` and `huly users` are small; cache their output in a
  file for the session rather than re-listing before every write.

## No `jq` available

```bash
huly tasks --assignee me --json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const {data}=JSON.parse(d);console.log(data.map(t=>t.identifier+" "+t.title).join("\n"))})'
```

## What not to do

- Don't print a full listing "for context" before filtering — filter first.
- Don't fetch all tasks to find one: `huly task <IDENTIFIER>` takes the identifier
  directly, and `--parent` / `--milestone-id` / `--status` narrow at the source.
- Don't re-fetch comment bodies; they come back as markdown already.
