# `huly-skill` vs `@firfi/huly-mcp` — summary comparison table

Date: 18/08/2026. We are at `v1.10.0`; they are at `0.49.5` (last commit 13/08/2026).
Our figures are measured directly; theirs come from source we read and from their own
documentation — **we did not run their binary**. Token conversion uses the 2.56 chars/token
ratio they measured with Claude's tokenizer.

Background: [detailed review](./review-firfi-huly-mcp.md) ·
[token cost analysis](./token-cost-analysis.md) ·
[transport ADR](./adr-0001-websocket-transport.md)

---

## Comparison table

| # | Criterion | `huly-skill` (us) | `@firfi/huly-mcp` (them) | Who wins |
|---|---|---|---|---|
| 1 | Tool count / domain coverage | 31 tools: tracker, document, milestone, label, comment, activity | 522 tools: plus drive, boards, cards, mail, calendar, recruiting, inventory, planner, processes, test-management, love | **Them** |
| 2 | Context cost, full mode | `tools/list` 19,589 B ≈ **7,650 tokens** | native ~435 KB ≈ **170,000 tokens** (their own measurement) | **Us** (22x) |
| 3 | Context cost, minimal mode | no mode smaller than 7,650 tokens | `proxy`: 4 meta-tools ≈ **500 tokens** | **Them** (14x) |
| 4 | Output discipline per call | shared cap of 50 + projection; `count`/`total`/`truncated`; `fields:"all"` to open up | `DEFAULT_LIMIT` 50, `MAX_LIMIT` 200, per-tool typed `resultSchema` | **Them** slightly — their output has a schema, we only have a field list |
| 5 | The "data never enters context" path | CLI + a skill that teaches `--limit/--fields` → `jq` → file; measured at 125x | has `@firfi/huly-cli@0.48.2`, skill points at "use `--help` as the source of truth" | **Level** — both have a CLI; the difference is how the agent is taught |
| 6 | Cost of the skill itself | `SKILL.md` 3.9 KB + `references/` 15 KB loaded on demand | `SKILL.md` 2.1 KB + `references/automation.md` 1.3 KB | **Them** — smaller, but we spell out the order of the cheapest path |
| 7 | Machine-readable error contract | `{status, error, code, retryable}` + `hint` for auth errors; 5 codes; exit status 2/3/4/5 by class | failure document `{code, message, retryable, hint, details}` + exit status by error class | **Level** (as of 18/08/2026) — both have codes, retryable, and exit status by error class |
| 8 | Credential management | `.env` + environment variables; `x-huly-*` headers per request; `HULY_REQUIRE_CALLER_TOKEN` fail-closed | `huly auth login` + `huly profile create/select` (token in OS config dir); `HULY_EMAIL/PASSWORD` or `HULY_TOKEN`; `x-huly-*` headers | **Them** on UX; **us** on fail-closed and on working with SSO+2FA |
| 9 | Understanding of Huly auth | documented the SSO/OIDC path, 2FA not gating SSO, UUID-vs-slug, unreleased PR #10624 | README only covers email/password or token; no mention of SSO | **Us** |
| 10 | Diagnostics without a connection | `huly_context` (465 B) + `whoami --offline`, with `warnings[]` pointing at the actual cause | `get_huly_context` — sanitized context, no config-warning section | **Us** slightly |
| 11 | Tests | 39 unit tests (`node --test` + `tsx`, 0 new dependencies) + 1 opt-in smoke test against a real workspace | 1,232 tests + 800+ integration calls against a real workspace, token certification harness | **Them**, by a wide margin |
| 12 | Quality gate | CI: typecheck, test, blocks bundle drifting from source | oxlint, dprint, jscpd, dpdm (circular), complexity gate, `effect-tsgo`, coverage | **Them** |
| 13 | SDK version vs server | `api-client@0.7.423` = server 0.7.423 | pinned `0.7.19` + self-maintained patch (400+ patches behind) | **Us** |
| 14 | Markup / collaborative doc | `MarkupOperations` comes free with the WS `PlatformClient` | rebuilt by hand: added `collaborator-client`, `createMarkupOps`, 3 markup files | **Us** — same capability, less debt |
| 15 | Runtime reach | WS: needs Node (fake-indexeddb, `window` polyfill) | REST: runs serverless / Cloudflare Workers | **Them** |
| 16 | Comments | one generic tool keyed on `_id` + class: issue, **milestone**, document, component; read + edit + delete, works on thread replies too | `list_comments` on issues only, but has update/delete, inline comments in documents, per-domain variants | **Us** (as of 18/08/2026) — same CRUD, we cover more object types; they still lead on inline comments in documents |
| 17 | Distribution / adoption | npm 39 downloads/month, 0 stars | npm 4,892 downloads/month, 46 stars, Docker, Smithery, Glama, MCP registry, own site | **Them**, by a wide margin |
| 18 | Release automation | `pnpm verify:release` (3 manifests + version the binary reports itself + bundle hash + clean stdout; `--packed` for the tarball), CI blocks bundle drift | `verify-version`, `certify-packed-artifact`, `local_release.sh`, publish-registry workflow | **Level** (as of 18/08/2026) — they automate the publish step too, we are still manual |
| 19 | Codebase readability / bus factor | 4,918 lines of src, plain TS, one person reads all of it in a sitting | 89,614 lines + Effect-TS 4 RC; signs of agent-loop generation (`RALPH.md`) | **Us** |
| 20 | Decision documentation for humans | ADR, auth research, cost analysis, competitor review in `reference/` | excellent lazy-tool PRD; the rest is process documentation | **Level** |
| 21 | Localization | English only since 1.10.0 — Vietnamese output was dropped so the repository speaks one language | English only | **Level** — this stopped being a difference; a localized CLI is worth less than a codebase any contributor can read |
| 22 | Handling upstream risk | states plainly that Huly has dropped to maintenance, npm stopped publishing on 10/05/2026, SDK hard-pinned | not mentioned | **Us** |

**Total: they win 9, we win 8, level 5.** Criterion 8 is counted for them because the first verdict in
that cell is theirs, though it splits: theirs on UX, ours on fail-closed and on working with SSO+2FA. An
earlier revision of this file reported 10–8–4; that was a miscount, not a change in the table.

But counting votes is the wrong way to read this. The eight cells we win are all about *operating cost and
the reliability of a small surface*; the nine they win are mostly about *scale* — coverage, test count,
distribution channels — which is the result of 1,119 commits and 89,600 lines. The two sides are optimizing
for two different problems.

---

## What is still worth learning (without contradicting the lean principle)

Updated 18/08/2026: three of four items are done; the fourth was dropped after measurement.

1. ~~**Machine-readable error contract**~~ (criterion 7) — **done**. Every JSON error from
   both the CLI and MCP now carries `code` (`auth` · `connection` · `not_found` ·
   `invalid_input` · `unknown`) and `retryable`; only `connection` is retryable.
   The Vietnamese message stays as it was, the new fields sit next to it.
   `src/utils/errors.ts`, 9 tests. Cost: 1 file, 95 lines, 0 dependencies.
2. ~~**Integration smoke test against a real workspace**~~ (criterion 11) — **done**.
   `HULY_SMOKE=1 pnpm smoke` runs create → read → list → comment → delete through the
   **built binary**, cleaning up the issue even if it fails midway. Not in CI
   because it needs credentials and writes to a real workspace.
3. ~~**`verify-version` and packed-artifact verification**~~ (criterion 18) —
   **done**. `pnpm verify:release` asks the binary itself what version it reports
   (`--version` + `initialize` handshake), compares the hash of `npm-package/huly-mcp.cjs`
   against `bin/mcp.cjs`, and blocks any non-JSON-RPC line from reaching stdout;
   `--packed` repeats it on the tarball `npm publish` would upload. CI runs it on every push.
4. **`outputSchema` for tools** (criterion 4) — **dropped, after measurement**. See the
   counter-argument table below.

Under consideration, not decided:

- **Credential profiles** (criterion 8) — `huly profile select` genuinely solves the
  multi-workspace problem. But it adds a layer of on-disk state, while
  `.env` + per-request headers already cover the per-user goal. Wait until someone
  actually needs two workspaces at once.
- ~~**Deeper comment support**~~ (criterion 16) — **done 18/08/2026**: `comments update`
  / `comments delete` on the CLI and `huly_update_comment` / `huly_delete_comment`
  on MCP, working on thread replies too. Still not done: inline comments
  in documents — needs a positioning layer inside markup, waiting for real demand.

## Where we stay skeptical — not following

| What they do | Why we do not follow |
|---|---|
| 522 tools | Their own evidence: native mode costs ~170K tokens, forcing them to invent `proxy` mode as a cure. Our 31 tools fit comfortably under Claude Code's defer threshold, load fully, and cost no lookup round-trip. Add tools only when a real user needs one, not to fill out coverage. **Review threshold: past 60 tools we have to revisit lazy loading.** |
| Effect-TS across the whole codebase | 89,600 lines for a wrapper around an SDK. Our 4,918 lines do the work we need. Moving to Effect means trading our strongest asset — one person can read all of it — for type safety that `tsc --noEmit` + zod mostly already give us. |
| Switching to a REST client | [ADR-0001](./adr-0001-websocket-transport.md): `RestClient` has no `MarkupOperations`, and markup is our main write path. They had to rebuild the markup + Tx layer to compensate. Only revisit if we need to deploy to an edge runtime. |
| Pinning an old SDK + self-maintained patch | They are on `api-client@0.7.19` against server 0.7.423. We match versions, and with Huly on life-support maintenance, matching versions is an asset, not perfectionism. |
| Proxy / lazy tool mode | Right for 522 tools, wrong for 29: it trades 7,650 static tokens for a discovery round-trip on every call, and makes `tools/list` lose prefix cacheability — the exact trap they name in their own PRD. |
| Declaring `outputSchema` on tools | Measured directly: adding an output schema to **one** list tool (6 fields) took `tools/list` from 18,264 B to 18,885 B — **+621 B**. Multiplied across 7 list tools with wider shapes (a task has 13 fields) that is roughly **+6 KB static ≈ +2,300 tokens per session**. Worse: per the spec, once you declare `outputSchema` the result **must** carry `structuredContent`, and *should* also carry the text version for backward compatibility — i.e. **the same payload sent twice**. We just cut list results 14x in 1.7.0; trading 2x of that back so clients can validate a schema undoes exactly what we just bought. Revisit if clients drop `content` entirely when `structuredContent` is present. |
| Large-scale agent-loop code generation | 1,119 commits in 6 months produced a large surface but with abstraction layers out of proportion to the domain. We choose growth driven by real, measurable demand. |

## How to read this table later

Three numbers worth re-measuring every time a tool is added: **tool count**, **`tools/list` bytes**, and
**bytes of the heaviest list call on a real workspace**. As long as column 2 stays under
~10% of the client's context window and column 3 stays under ~25 KB, the lean principle is still
paying off. Once it does not, re-read the "skeptical" section — that is when their argument becomes
ours.
