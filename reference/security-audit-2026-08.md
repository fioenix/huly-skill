# Transitive advisories, 18/08/2026

`pnpm audit` reported 41 advisories, none in code this project wrote. This note
records how they were triaged, what was fixed, and why the remainder are left
alone — so the next person does not repeat the triage, and does not "fix" the
part that needs no fixing.

## The question worth asking

Not *how many advisories* but *which of them reach a user*. This project ships two
esbuild bundles, `bin/mcp.cjs` and `bin/bundle.cjs`. A package in the dependency
graph that esbuild never pulls into either one is present at build time and absent
at run time. The lockfile cannot tell those apart; esbuild's `--metafile` can,
because it lists every input that made it into the output.

So each vulnerable package was checked against the metafile of both bundles.

## What reached the bundles — fixed

| Package | Was | Now | Severity | Comes from | Bundle |
|---|---|---|---|---|---|
| `ws` | 8.19.0 | 8.21.3 | high + moderate | `@hcengineering/api-client` | both |
| `fast-uri` | 3.1.2 | 3.1.5 | high ×3 | `ajv` ← `@modelcontextprotocol/sdk` | MCP |
| `linkify-it` | 5.0.0 | 5.0.2 | high ×2 | `markdown-it` | both |
| `markdown-it` | 14.1.1 | 14.3.0 | moderate | `@hcengineering/text-markdown` | both |
| `body-parser` | 2.2.2 | 2.3.0 | low | `express` | MCP |
| `@hono/node-server` | 1.19.14 | 1.19.17 | moderate | `@modelcontextprotocol/sdk` | MCP |

`ws` is the one that mattered most: it is the WebSocket transport every call goes
through ([ADR-0001](./adr-0001-websocket-transport.md)), and the advisory is memory
exhaustion from tiny fragments plus uninitialised memory disclosure.

None of these are direct dependencies, and upstream has not moved — `api-client`
is pinned at 0.7.423 and Huly is on maintenance footing. They are forced through
`overrides` in `pnpm-workspace.yaml`.

**Each range is capped inside the major upstream depends on.** A bare `>=` first
pulled `markdown-it` 15 and `linkify-it` 6 into a code path upstream never tested
with them. That is the trap in this technique: an override silences the audit
line whether or not the result still works.

Verified after the overrides, not assumed: typecheck, 42 tests, `tools/list`
unchanged at 31 tools / 19,589 B, a live WebSocket connection (`huly whoami`),
markdown rendering through the patched `markdown-it`/`linkify-it` (`huly task`
description), and the HTTP transport answering `initialize` (`body-parser`,
`@hono/node-server`).

## What stays — and why that is the right answer

31 advisories remain. Not one of them is in a package esbuild puts in either
bundle:

| Package | Advisories | Comes from | Why it never ships |
|---|---|---|---|
| `hono` | 12 | `@modelcontextprotocol/sdk` | the SDK's own HTTP server; this project uses `express` instead |
| `dompurify` | 10 | `@hcengineering/activity`, `chunter` | sanitising HTML for Svelte components |
| `svelte` | 6 | `@hcengineering/activity`, `chunter` | those packages ship UI; only their class definitions are imported |
| `ip-address` | 3 | `@modelcontextprotocol/sdk` | proxy address parsing in a path not reached |

The `@hcengineering` half could not be fixed anyway: those packages must match
the Huly server version, 1.6.1 shipped two copies of `core` because they drifted,
and Huly's release cadence has collapsed
([positioning note](./positioning-2026-08.md)). Overriding svelte or dompurify
underneath them would risk a working build to silence a line about code that is
not in the product.

The honest position is to say so out loud rather than chase the number to zero.
`SECURITY.md` states it for anyone assessing the package.

## The check that replaces the triage

`pnpm audit:shipped` (`scripts/audit-shipped.mjs`) rebuilds both metafiles, maps
every input back to a package name, and fails **only** when an advisory names a
package that is actually inside a bundle. CI runs it on every push.

That gate answers the question this note started with, every time, instead of
someone re-reading 31 upstream advisories each month. A red run has exactly one
remedy: add the patched range to `overrides`, capped inside the current major, and
exercise the code path it belongs to.

A permanently red `pnpm audit` gate would have been worse than none — it trains
people to ignore it.
