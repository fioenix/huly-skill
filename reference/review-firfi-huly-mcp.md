# Review: `dearlordylord/huly-mcp` (npm `@firfi/huly-mcp`)

Review date: 17/08/2026. Subject: the public repo at
https://github.com/dearlordylord/huly-mcp, last commit `2026-08-13`, version `0.49.5`.
Compared against `huly-skill` (this repo).

## 1. Who came first

| | `@firfi/huly-mcp` | `huly-skill` |
|---|---|---|
| First commit | **01/02/2026** (`ee347c3 init`) | 17/03/2026 (`6ae0ce0 chore: initial public-safe commit`) |
| Repo created on GitHub | 02/02/2026 | 17/03/2026 |
| Last commit | 13/08/2026 | 17/08/2026 |
| Total commits | 1,119 | ~43 merged PRs |

**They came ~6 weeks earlier.** Note: our first commit says "initial public-safe
commit", so private history may predate 17/03, but there is no public evidence
of anything earlier than 01/02/2026. No sign of borrowed code in either
direction: they use Effect-TS + a REST client + unprefixed tool names (`create_issue`),
we use plain TS + the WebSocket platform client + the `huly_` prefix (`huly_create_task`).
Two independent codebases, both MIT licensed.

## 2. Scale — not the same weight class

| | `@firfi/huly-mcp` | `huly-skill` |
|---|---|---|
| LOC (src, excluding tests) | ~89,600 | ~4,565 |
| MCP tool count | **522** | 28 |
| Test cases | 1,232 (289 test files) | 0 |
| CI | GitHub Actions (`check-all` quality gate) | none |
| npm | `@firfi/huly-mcp` v0.49.5 | `@fioenix/huly-mcp` v1.6.1 |
| GitHub stars / forks | 46 / 20 | 0 |
| Distribution | npm, Docker, Smithery, Glama, MCP registry, Cloudflare (wrangler), own site | npm |

Their domain coverage is far wider: beyond tracker/document/milestone like ours, they also have
boards, cards, drive, inventory, leads, recruiting, mail, calendar, planner,
processes, test-management, love (virtual office), notifications, custom fields,
generic associations, model administration.

## 3. Four design points worth learning from

**a. Multi-tenancy via HTTP headers.** The HTTP transport takes credentials per
request: `x-huly-url`, `x-huly-workspace`, `x-huly-token`
(`src/config/huly-config-constants.ts:4`). One server serves many workspaces,
each caller bringing their own credential. This is exactly the answer to risk #3 in our
[huly-auth.md](./huly-auth.md): our MCP HTTP build holds **one** Huly
credential in the process, and anyone past `HULY_MCP_AUTH_TOKEN` gets the full rights of that token.

**b. Tool exposure mode `auto | native | proxy`** (`src/mcp/tool-mode.ts`).
No client can load 522 tools, so `proxy` mode exposes only meta-tools
(`list_tool_categories`, `search_tools`, …) and lets the agent look up and then call. `auto`
keeps native for `claude-code` and switches to proxy for Codex/Cursor/Windsurf/Copilot.
Plus `TOOLSETS` / `TOOLS` for filtering. At 28 tools we do not need this yet, but the pain threshold is
~50–80 tools — if we expand, this is the pattern to copy.

**c. The `get_huly_context` tool** — returns sanitized runtime/config (version,
transport, auth mode, origin/host, workspace, config source) **without connecting to
Huly**, and never returns a token/password/email. Our `huly_whoami` has to
connect before it can say anything, so diagnosing a bad credential is harder.

**d. Certification harness for tokens.** `scripts/api-token-certification.ts`
runs two phases, *active* and *revoked*, over both stdio and HTTP, then **scans the output/diagnostics
in memory to make sure the token is never printed**; if it finds the secret, it fails. We do not have
this level of discipline.

## 4. The architectural difference — and who pays for it

They use a **REST client** (`sdk.createRestClient`, `src/huly/client.ts:678`) on
`@hcengineering/api-client@0.7.19` **with a patch** (`patches/@hcengineering__api-client@0.7.19.patch`
— fixing `lookupMap` handling in `lib/rest/rest.js`). We use the **WebSocket platform
client** (`connect()`) on `api-client@0.7.423`.

| | REST (them) | WebSocket (us) |
|---|---|---|
| Startup | no model bootstrap, fast | loads the model over WS, slower |
| Environment | runs serverless / Cloudflare Workers | needs `fake-indexeddb` + a `window` polyfill |
| API surface | thinner, missing full TxOperations/collab markup | full hierarchy, markup, collaborative docs |
| Technical debt | **SDK pinned at 0.7.19** while the server is 0.7.423, requiring a self-maintained patch | SDK matches the server version |
| stdout noise | not an issue | must redirect `console.log` to stderr (`src/bootstrap.ts`) |

Why we chose WebSocket — and the price REST made them pay (they had to rebuild the
markup layer with `@hcengineering/collaborator-client`, `createMarkupOps` at
`src/huly/client.ts:635-691`) — see [ADR-0001](./adr-0001-websocket-transport.md).

**On latency there is no one-sided conclusion**: REST is one HTTP round-trip per
call (`RestClientImpl` fetch + `withRetry` on every request), while WS pays once
at handshake and then multiplexes. Our workload is a chain of small consecutive queries
(list tasks → comments per task → resolve person), the kind where WS usually
wins after the first call. This is reasoning from architecture, not a measurement.

## 5. Their weaknesses

- **89,600 LOC + Effect-TS** for an MCP wrapper is an enormous cognitive cost.
  The repo has `RALPH.md` / `START_RALPH.md` — a sign of code generated by an automated
  agent loop; the commit count (1,119 in 6 months) reinforces that. Consequence: many layers of
  abstraction for a domain that is not correspondingly complex (65 files in `src/mcp/tools`,
  ~30 `errors-*.ts` files).
- **One maintainer, bus factor = 1**, and the stack (Effect 4 RC, `oxlint`, `dprint`,
  `effect-tsgo`) makes it hard for outsiders to contribute.
- **No guidance for SSO / 2FA.** The README only covers `HULY_EMAIL`+`HULY_PASSWORD`
  or `HULY_TOKEN`; troubleshooting has an "account locked after failed login
  attempts" entry (they have hit `isAccountPasswordLocked`), but says nothing about where to get a token
  when the workspace uses Google SSO. Exactly the gap we just
  researched.
- **522 tools is a double-edged sword**: even in proxy mode the agent still pays an extra
  lookup round-trip, and every tool is another surface that can be wrong.

## 6. Independent confirmation of our authentication research

`INTEGRATION_TESTING.md:251-253` states: their harness only certifies the
"legacy-token" flow; **personal API-token compatibility remains `uncertified` until
issues #205–#208 can run against a *released* Huly Platform build containing PR
#10624**. This matches conclusion 4 in [huly-auth.md](./huly-auth.md): PR
#10624 (revocable API tokens) is not in any tag. A different project, tracking independently,
reaching the same conclusion — that raises confidence in the "Option 3 but not implemented yet" decision.

## 7. Measurement: how far does "leaner" actually hold

Real numbers, not impressions:

| Axis | `@firfi/huly-mcp` | `huly-skill` | Ratio |
|---|---|---|---|
| LOC (src, excluding tests) | 89,614 | 4,565 | **19.6x** |
| Tool count | 522 | 28 | **18.6x** |
| npm unpacked | 8,407,717 B (8.4 MB) | 2,916,942 B (2.9 MB) | **2.9x** |
| `tools/list` (native) | ~300–600 KB estimated → ~75k–150k tokens | **15,721 B → ~3,930 tokens** | ~20–40x |

How the last column was measured: run `initialize` + `tools/list` over stdio into `bin/mcp.cjs` →
28 tools, a 15,721-byte payload. Theirs was not run (no handing credentials to a
third-party binary), so it is estimated from the tool table in their README — which is generated
automatically from the tool definitions: **526 lines, 121,390 bytes for names + descriptions alone**
(mean 203, max 1,301 chars/description), before any JSON input schema. This is exactly why they
had to build proxy mode.

**But this context advantage evaporates once they switch on proxy mode**: at that point they expose only
4 meta-tools (`list_tool_categories`, `search_tools`, `get_tool_schema`,
`invoke_tool`), lighter than our 28 tools, in exchange for a discovery round-trip on every call.
And `auto` mode turns proxy on by default for Codex/Cursor/Windsurf/Copilot.

**Not measured yet**: startup latency and RAM. On architectural principle their REST setup
starts up lighter than ours — no model bootstrap over WebSocket, no
`fake-indexeddb`, no `window` polyfill, no redirecting `console.log` to
stderr like `src/bootstrap.ts`. Getting real numbers would mean running their binary with your own
Huly credentials; that is your decision, not mine.

## 8. Conclusion

They shipped 6 weeks before us and have gone much further on coverage, test discipline and distribution.
Where we still hold distinct value: a surface small enough for one person to read entirely, a CLI +
agent skill in Vietnamese, an SDK matching the server version, and (after this research) an understanding
of the SSO/2FA path that they have not documented.

Three things worth doing, ordered by value/cost:

1. **Per-request credentials for the HTTP transport** (`x-huly-*` headers) — removes
   the "server holds one shared token" risk entirely.
2. **A diagnostic tool that needs no connection**, in the style of `get_huly_context`.
3. **Add tests + CI**. We currently have 0 tests, 0 workflows; they have 1,232 tests and a quality
   gate. This is the biggest technical gap, not tool count.

Not proposing that we race the 522 tools: that is their direction, not ours.
