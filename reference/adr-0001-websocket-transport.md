# ADR-0001 — Use the WebSocket `PlatformClient` instead of `RestClient`

- **Status**: Accepted
- **Date**: 17/08/2026 (recording a decision made at the start of the project; until now it
  existed only implicitly in the code)
- **Scope of impact**: [`src/client.ts`](../src/client.ts),
  [`src/bootstrap.ts`](../src/bootstrap.ts), every write path in the CLI and MCP

## Context

`@hcengineering/api-client` offers two ways into a Huly workspace:

- `connect(url, options)` → `PlatformClient`, over WebSocket to the transactor.
- `connectRest(url, options)` / `createRestClient(endpoint, ws, token)` →
  `RestClient`, over HTTP `/api/v1`.

We had to pick one for `huly-skill` — a CLI + MCP server running on Node, with a workload of
reading/writing issues, comments, documents, milestones, labels.

## Decision

Use the **WebSocket `PlatformClient`** (`src/client.ts:133`).

## Rationale

`RestClient` (`api-client@0.7.423`, `src/rest/types.ts`) is just
`Storage & FulltextStorage` plus four methods: `getAccount`, `getModel`,
`domainRequest`, `ensurePerson`. `PlatformClient` (`src/types.ts`) is
`FindOperations & DocOperations & CollectionOperations & MixinOperations &
MarkupOperations`.

Three capabilities REST **does not have**, that our write path depends on:

1. **MarkupOperations** — `uploadMarkup`, `fetchMarkup`, and
   `client.markup.collaborator.updateMarkup`. Used at `src/client.ts:381`, `:475`,
   `:599`, `:624`, `:818`. Without them, issue descriptions and document content
   (markdown ↔ collaborative doc) cannot be read or written: `huly_create_document`,
   `huly_read_document`, and the task `--description` all disappear.
2. **DocOperations / CollectionOperations** — `createDoc`, `updateDoc`,
   `addCollection`, `removeDoc`. REST only exposes raw `tx` from `Storage`, so you have to
   build the Tx yourself: rank, collection counters, `attachedTo` / `attachedToClass`.
3. **Hierarchy on the spot** — `getHierarchy()` is synchronous. REST gives you async
   `getModel()`, which must be fetched before use.

**Corroborating evidence**: `dearlordylord/huly-mcp` chose REST and had to rebuild the
markup layer — adding the `@hcengineering/collaborator-client` dependency, writing
`createMarkupOps` (`src/huly/client.ts:635-691`), `toInternalMarkup`, plus
`operations/markup.ts`, `native-reference-markup.ts`, `huly-text.ts`. REST is not
cheaper in lines of code; it trades one set of costs for another. See
[review-firfi-huly-mcp.md](./review-firfi-huly-mcp.md).

## Options considered

**A. REST `RestClient`.** Gains: no browser-API polyfills, runs on
serverless / Cloudflare Workers, startup does not load the model. Losses: build markup
yourself via the collaborator client, build Tx yourself, handle hierarchy yourself. Rejected because markup
is our main write path, not a side feature.

**B. Hybrid — REST for reads, WS for markup writes.** Gains: could reduce read latency.
Losses: two clients, two auth flows, two error sets, two places caching person/project. Rejected
because the size of the project does not justify that complexity cost.

**C. WS `PlatformClient`** — chosen.

## Consequences

**What we accept** (all contained in `src/bootstrap.ts`, not ad-hoc hacks):

- `fake-indexeddb/auto` and `window` / `localStorage` / `navigator` polyfills, because
  `client-resources` was written for a browser environment.
- Redirecting `console.log|info|debug` to stderr: `client-resources` prints connection logs
  to stdout, which breaks both the CLI's `--json` and the MCP stdio JSON-RPC framing.
- A hand-written WebSocket factory that accepts a proxy (`src/client.ts:17`) for environments with
  `HTTPS_PROXY` (the Cowork sandbox).
- Bootstrap cost on every connection: loading the model over WS.
- **Cannot** run on a runtime without a Node-style WebSocket client (Cloudflare
  Workers). If we later want to host MCP on the edge, this ADR has to be reopened.

**What we get**: markup/collab for free, TxOperations for free, an SDK matching the
server version exactly (0.7.423 ↔ 0.7.423 on `work.yody.io`), and multiplexing many calls over one
connection — which suits a workload of many small consecutive queries (list tasks → comments per
task → resolve person). Note: the multiplexing part is architectural reasoning, not measured.

## When to reopen this decision

- We want to deploy MCP to an edge runtime (Cloudflare Workers, Deno Deploy).
- Huly adds markup operations to `RestClient`.
- We measure that bootstrapping the model over WS is a real bottleneck for short commands.
