# Shipped dependency remediation, 25 October 2026

Baseline `cde5df9` and instruction-only PR91 had 39 advisories reaching shipped
dependencies (85 in the graph). They were existing findings, not PR91
regressions. This separate change reduces the reported shipped audit to one metadata finding
(47 in the graph), without a suppression or a claim of a fresh skills.sh PASS.

| Package | Before | Locked after remediation |
|---|---|---|
| undici | 7.29.0 | 7.30.1 |
| @modelcontextprotocol/sdk | 1.30.0 | 1.32.2 |
| zod | 4.4.3 | 4.6.7 |
| fast-uri | 3.1.5 | 3.1.9 |
| markdown-it | 14.3.0 | 14.3.3 |
| body-parser | 2.3.0 | 2.4.0 |
| qs | 6.15.2 | 6.16.1 |
| proxy-addr | 2.0.7 | 2.0.8 |
| prosemirror-view | 1.41.6 | 1.42.8 |
| @tiptap/core | 2.27.2 | 2.27.3 (official v2 backport) |

Direct minimums and same-major overrides prevent resolution back to known
vulnerable versions. Huly packages stay aligned at 0.7.423. Tiptap core moves to
2.27.3; pm/extensions retain their existing accepted v2 contracts.
Undici 7.30.1 retains Node >=20.18.1; body-parser 2.4.0 requires qs ^6.16.1.

## Runtime limits and compatibility

The SDK's input-element protection is opt-in. The server now rejects more than
16 recursive argument object members/array entries before validation or tool
execution. Existing tools have flat scalar schemas with at most 11 members;
string lengths are unaffected. Over-limit calls return the SDK's native
`isError` result, not a Huly envelope.

HTTP explicitly retains Express's existing 100kb (102,400-byte) JSON limit,
including expanded compressed input. Compression remains supported. The HTTP
app factory is extracted from the listener entry point so the production
middleware/routes can be tested using streams without opening sockets, loading
credential files or connecting to Huly.

Sources: [SDK input/body advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453),
[body-parser fix](https://github.com/advisories/GHSA-27r3-jxmh-p828).

## Official Tiptap v2 backport and advisory metadata

The earlier v3-only recommendation was based on the advisory's patched-version
field. Further artifact verification established an official v2.27.3 release:
[maintainer backport PR8301](https://github.com/ueberdosis/tiptap/pull/8301) and
[release PR8310](https://github.com/ueberdosis/tiptap/pull/8310). The npm tarball
matches its registry SHA512; its CJS distribution differs from 2.27.2 only by a
10-line `Object.defineProperty` guard for own `__proto__` keys. Export/peer
contracts are unchanged and existing Huly ranges accept it. No major migration,
Huly server/schema upgrade or local fork is needed.

Core 2.27.3 is pinned and selected in the actual dependency graph. Regression
tests confirm its merge helper keeps the normal object prototype, preserves
own JSON `__proto__` as a data property, does not inherit attacker attributes,
and retains ordinary class/style/id behavior. Object/null/string values,
multiple argument positions and repeated merges are covered. The old installed
2.27.2 helper fails that security test; this is a package behavior regression
check rather than a source-text/version assertion.

[GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh) metadata
still lists only 3.30.4 as patched. [Upstream issue8339](https://github.com/ueberdosis/tiptap/issues/8339)
tracks the missing v2 backport range, so audit/CI may remain red despite the
verified helper fix. No suppression, exception or audit-gate change is added.
Report that metadata result separately from the tested code behavior; do not
claim a fresh skills.sh PASS.

The helper replaces a returned object's prototype in the old version, not the
global Object.prototype. This product's current Markdown paths have not shown
a browser DOM/XSS chain. Representative synthetic coverage does not call the
Tiptap HTML serializer or merge helper; bundle presence still warrants patching.

## Verification

The dedicated Tiptap test uses the actual installed helper selected by the
production dependency graph; it does not execute a hand-copied replacement.
The tests also use real SDK in-memory transports for accepted/rejected argument
limits and ordinary strict validation. Stream-backed HTTP requests cover plain
and gzip initialization, the exact byte limit, one byte over, chunked input,
compressed expansion, malformed and trailing JSON. The actual description
conversion pipeline runs against a synthetic collaboration store and preserves
coordinates, nested Markdown, links, inline HTML's existing plain-text behavior
and literal instruction text.

An independent in-memory baseline comparison found the same 31 tools and exact
JSON schemas. Run typecheck, the complete test suite, build, pack:skill,
verify:release (including --packed), the Node runtime floor and audit:shipped;
record each result in the PR rather than inferring all PASS from an audit delta.
Live Huly smoke is excluded because it writes to a real workspace.

PR91 stays independent and supplies the workspace-content instruction boundary.
After combining the branches, regenerate artifacts from the combined sources
rather than choosing either ZIP/bundle blindly. The ZIP must contain PR91's
SKILL.md/recipes boundary and this branch's rebuilt CLI together; taking either
existing ZIP loses one side. Their Unreleased changelog blocks also need combining. This change does not include a
model-driven W011 replay or retry the previously denied Codex runtime.
