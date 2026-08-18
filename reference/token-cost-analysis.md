# Real token cost: `huly-skill` vs `@firfi/huly-mcp`

Date: 18/08/2026. The hypothesis to test: "in practice they burn far more tokens than we do".
**Result: false — on static cost we are cheaper, but on per-call cost
we are roughly 18–30x more expensive, and that is the part that repeats all session long.**

## Method

- Our numbers: measured for real. `initialize` + `tools/list` over stdio into `bin/mcp.cjs`; and
  `./bin/huly.cjs tasks --json` against a real workspace (`work.yody.io`, 249 tasks).
- Their numbers: taken from their own documentation (`docs/02_LAZY_TOOL_PRD.md`) and read from source
  for the schema/limit parts. **We did not run their binary** (no handing credentials to
  third-party code).
- Token conversion: using exactly the ratio they measured with Claude's tokenizer — 435 KB ↔ 170K
  tokens, i.e. **~2.56 chars/token** for JSON schema. The 4-chars/token heuristic is far too
  optimistic for JSON.

## 1. Static cost — `tools/list`, once per session

| | Payload | Tokens |
|---|---|---|
| Us (28 tools) | 15,721 B (measured) | **~6,100** |
| Them, `native` (470 tools, their number) | 435 KB (their measurement) | **~170,000** (they measured with `/context`) |
| Them, `proxy` (6 tools: `get_version`, `get_huly_context`, `list_tool_categories`, `search_tools`, `get_tool_schema`, `invoke_tool`) | — | **~500** (their estimate) |

Here we are ~28x cheaper than their native mode. **But native is not their default for
most clients.** The `auto` mode table (`src/mcp/tool-mode.ts:85`, PRD lines 150–161):

- `claude-code` (exact match) → **native**, because Claude Code defers tool
  definitions itself since 01/2026 once the tool surface exceeds ~10% of the context window.
- `claude-ai`, `cursor*`, `windsurf*`, `copilot*`, `codex*`, `opencode*`, and
  unknown clients → **proxy** (~500 tokens).

Which means: on Cursor/Codex/Copilot, **they are ~12x cheaper than us** on static cost. On Claude
Code, those 170K tokens do not sit directly in context but get deferred to tool search —
exactly the mechanism running in this session. Our 6,100 tokens sit under the defer threshold,
so they load in full, always ready, with no lookup round-trip — that is our real advantage,
but it is an advantage in *convenience*, not the 28x saving the raw number suggests.

## 2. Per-call cost — where we lose badly

Measuring `huly_list_tasks` (no filter) against a real workspace:

| | Result |
|---|---|
| Tasks returned | 249 (**no `limit` parameter**) |
| Task array | 204,071 B |
| Whole response | 273,771 B → **~107,000 tokens** |
| Fields per task | **32** — returns Huly's raw doc verbatim (`...task`, `src/mcp/tools.ts:133`) |

The byte distribution by field shows most of it is noise to a human reader: `attachedToClass`
5.0%, `attachedTo` 4.5%, `space` 4.3%, `modifiedBy` 4.3%, `createdBy` 4.2%, `kind`
4.1%, `_class` 3.8%, `collection` 3.1%, plus `rank`, `childInfo`, `docUpdateMessages`,
`relations`, `parents`, `reports`.

**One `huly_list_tasks` call of ours ≈ 107K tokens — about 63% of their entire native tool
surface, and it repeats on every call.** In practice Claude Code will truncate an oversized
tool result, so the real outcome is one of two things: burning context, or **silent data
loss**. Both are bad.

The same operation on their side: `list_issues` returns `IssueSummarySchema` — **11 curated
fields** (`issueId`, `identifier`, `title`, `status`, `priority`, `assignee`,
`creator`, `parentIssue`, `subIssues`, `labels`, `milestone`, `modifiedOn`), with
`DEFAULT_LIMIT = 50`, `MAX_LIMIT = 200` (`src/domain/schemas/shared.ts:8-9`). Estimated
~250–350 B/issue → ~15 KB ≈ **~6K tokens** for a default call.

For comparison on the same data, if we kept only the 9 fields we actually use:

| Configuration | Bytes | ~Tokens | vs current |
|---|---|---|---|
| Current (32 fields, 249 tasks) | 204,071 | ~80,000 | 1x |
| Lean 9 fields, 249 tasks | 40,611 | ~15,900 | **5x smaller** |
| Lean 9 fields + `limit=50` | 6,900 | ~2,700 | **30x smaller** |

## 3. Conclusion

- **The hypothesis is false in real use.** We only win on the `tools/list` load
  (once per session, and only against their native mode). We lose on every call
  after that.
- A session producing a weekly report calls `list_tasks` 5–10 times and burns hundreds of
  thousands of our tokens, while they pay 170K once and then a few thousand per call.
- Our weakness is not "few tools" but **no projection and no
  limit** — meaning we have no output discipline, which they do have via
  per-tool `resultSchema`.

## 4. What to do (ordered by measured impact)

1. **`limit` with a default of 50 on every list tool** (`huly_list_tasks`,
   `huly_list_projects`, `huly_list_documents`, `huly_list_milestones`,
   `huly_list_labels`, `huly_list_users`, `huly_list_sub_issues`). Right now only
   `huly_get_activity` and `huly_get_comments` have `limit`, and a default of 200 is still high.
2. **Field projection for list tools**: return a curated field set instead of `...task`
   (`src/mcp/tools.ts:133`), same for `...doc` (`:373`). Keep the raw doc only in
   `huly_get_task` / `huly_get_task_by_id`, where people actually need the detail.
3. **A `fields` parameter (opt-in)** for anyone who needs more fields, instead of returning everything by default.
4. **Cursor/offset pagination**, with `totalCount` so the agent knows how much is left.
5. **A regression test on output size**: a test asserting a list tool's response
   does not exceed an agreed byte threshold — to prevent drifting back to today's state.

The first three are small changes in `src/mcp/tools.ts` and give a **30x** token reduction on
exactly the hot path. But that is only the **floor**, not a strategy — see section 5.

## 5. Real token optimization of agent context

`limit` + projection only stop results overflowing. The four axes below are what decide
whether a session costs 30K or 300K tokens. Ordered by measured impact.

### a. Return an *answer*, not a *dataset* — measured at 20x

`huly_report weekly` (server aggregates it) = **13,209 B ≈ 5,200 tokens** for the whole
weekly picture. The same question via `huly_list_tasks`, leaving the model to filter and
count = **273,771 B ≈ 107,000 tokens**. A **~20x** difference, and the aggregate is more correct
too, because the counting is done by code, not by the model.

Implication: whenever a business question recurs (squad progress, overdue work, milestone
rollup), the thing to add is **a tool that returns an aggregated result**, not a
tool that returns more raw data. This is the axis where we have the advantage (`huly_report`,
`huly_milestone_report`) but have not exploited it: SKILL.md does not teach the agent to prefer
this path before calling list.

### b. Data that never needs to enter context — CLI pipeline, measured at 125x

This is the axis **pure MCP can never do**: every tool result has to pass
through context. The CLI does not — the agent writes one command, raw data flows through `jq`/`awk`
or into a file, and **only the final result enters context**.

Measured for real on the same 249 tasks:

| Path | Into context | Comparison |
|---|---|---|
| `huly_list_tasks` (MCP) | 273,771 B ≈ 107,000 tokens | 1x |
| `huly tasks --json \| <reduce>` (CLI) | **2,178 B ≈ 850 tokens** | **~125x smaller** |

Anthropic reports the same pattern (code execution with MCP) taking a workflow from ~150K
down to ~2K tokens (98.7%); the competitor's own PRD concedes that proxy meta-tool approaches
do **not** solve the intermediate-results problem (`docs/02_LAZY_TOOL_PRD.md:54`).

**A note on the advantage**: we have a CLI, but so do they — `@firfi/huly-cli@0.48.2` is
published, with its own skill. So the advantage is not in *having* a CLI but in **whether the skill
teaches the agent to use a pipeline instead of calling a bulk tool**. Our SKILL.md currently
does not teach that → the advantage is going unused.

### c. Cost of the skill itself — we are 6x heavier

The skill body is loaded into context on activation, before any tool is called.

| | Size |
|---|---|
| `skills/huly-skill/SKILL.md` (us) | **13,059 B** — one block, loaded in full |
| `AGENTS.md` (us, for Codex/Antigravity) | 10,333 B |
| `packages/huly-cli/skills/huly-cli/SKILL.md` (them) | **2,112 B** + `references/automation.md` 1,296 B loaded on demand |

They use progressive disclosure: a 2 KB core, details left in `references/` and only read
when genuinely needed. We load 13 KB every time. This is a fixed cost, paid every session, and it is
the easiest of the four axes to fix.

### d. Number of round-trips and cache-friendliness

Every tool call is a request/response pair that stays in history and is resent on
every subsequent turn until compaction — so a 107K result is not a one-time
cost, it is a tax levied over the rest of the session. Reducing the **number** of calls needed to
finish a job (tools per task, not per endpoint) is therefore worth more than reducing the size
of each call.

On prompt caching: our `tools/list` is static and does not mutate mid-session → the prefix is
cacheable. They name exactly this trap in their PRD (`:124`): mutating the tool list mid-session
loses the cached prefix, and a cache miss can cost more than the schema you saved. We are
on the right side of it; we just must not lose it as we add tools.

### What to do, reordered by real impact

| # | Task | Measured impact | Cost |
|---|---|---|---|
| 1 | SKILL.md teaches the priority order: **report/aggregate → CLI pipeline → list tool** | decides whether axes a and b get used at all | very low |
| 2 | Split SKILL.md into a ~2 KB core + `references/` | 13 KB → ~2 KB per session | low |
| 3 | Add `--fields` / `--limit` to the CLI so pipelines stay compact | opens the path to 125x | low |
| 4 | Expand the aggregate tool family (rollup by squad/milestone/assignee) | ~20x for recurring questions | medium |
| 5 | `limit` + projection on every list tool (section 4 above) | 30x for individual calls | low |

This order differs from section 4: items 1–3 are cheaper and higher impact than item 5, because they change
**which path the agent takes**, while item 5 only makes the old path cheaper.
