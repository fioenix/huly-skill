# Shipped dependency remediation, 25 October 2026

Baseline `cde5df9` and instruction-only PR91 had 39 advisories reaching shipped
dependencies (85 in the graph). They were existing findings, not PR91
regressions. This separate change reduces the shipped audit to one finding (47
in the graph), without a suppression or a claim of a fresh skills.sh PASS.

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

Direct minimums and same-major overrides prevent resolution back to known
vulnerable versions. Huly packages stay aligned at 0.7.423; Tiptap stays 2.27.2.
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

## Remaining Tiptap advisory

`@tiptap/core` 2.27.2 is present in both bundles through Huly text. The published
fix for [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh)
is 3.30.4, across Huly text's ^2.11.7 contract and the matching 2.x extension
family. Forcing only core to v3 risks incompatible markup/editor contracts.
No compatible v2 backport has been established here; a coordinated migration or
vetted backport needs separate approval. The advisory's browser DOM/attribute
execution chain has not been demonstrated in this Node CLI/MCP. Bundle presence
is established, not a reproduced browser XSS exploit.

This advisory remains visible: `audit:shipped` and CI are expected to remain red
for it. The audit gate is not weakened. Other graph advisories in unshipped UI
or unused server dependencies are not silently treated as runtime findings.

## Verification

The tests use real SDK in-memory transports for accepted/rejected argument
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
rather than choosing either ZIP/bundle blindly. This change does not include a
model-driven W011 replay or retry the previously denied Codex runtime.
