# Goal: an API token per user — our shortcomings and how to fix them

Date: 17/08/2026. The goal has been narrowed: **one token per person, so Huly records
who did what correctly**. Revocation and expiry are **not** goals.

## What this changes

With that goal, **Huly is no longer the blocker**. PR #10624 (revocable API tokens),
the unreleased tag, npm publishing stopped since 10/05/2026 — all of that concerns only
*revocation* and *exp*. Per-user tokens are achievable **today** on 0.7.423,
via two verified paths ([huly-auth.md](./huly-auth.md)):

- **Self-service**: each person signs in with Google SSO and takes their own token
  (URL `/login/auth?token=`, the `presentation-metadata-Token` cookie, or the WS URL
  `wss://<transactor>/<JWT>`). No admin needed. 2FA does not block it because the SSO path does not
  check `tfaSecret`.
- **Admin mint**: `generateToken(accountUuid, workspaceUuid, {})` with
  `SERVER_SECRET`, or `tool generate-token <email> <workspace>`.

So what blocks us is **our own architecture and tooling**, not upstream.

## Our shortcomings, measured against this exact goal

Scope note: the goal is to **add** per-user tokens, **not remove** the shared
token. The shared token remains a valid default for integrations/automation with no person
behind them; per-user is an added path for anyone who wants writes attributed to themselves.

**1. Credentials are read from `process.env` deep in the core.** `getApiKey()` /
`getHost()` / `getWorkspaceId()` ([src/utils/auth.ts](../src/utils/auth.ts)) are called
directly inside `HulyClient.connect()` ([src/client.ts:128](../src/client.ts)). Consequence:
**one process = one identity**, with no way to pass a different identity in. This is the
root of every other shortcoming.

**2. The HTTP transport defeats the goal entirely.** `POST /mcp`
([src/mcp/index.ts:56](../src/mcp/index.ts)) creates a new server per request — the architecture
is already ready for per-request credentials — but the credential still comes from env, so **every
caller writes under one person's name**. `HULY_MCP_AUTH_TOKEN` only guards the door, it does not
distinguish who is at it.

**3. `HULY_ACTOR` is fake attribution, and it hides the problem.** It just pastes
`Requested by: <name>` onto the task; Huly still records the author as the token owner. Anyone reading
Huly's logs sees the wrong person. It exists **because** we have not solved per-user — keeping it
after we do would give us two sources of truth.

**4. The README teaches the wrong path.** It says the token is "issued from workspace settings,
admin-only", so readers conclude they must request one from an admin each time. In reality anyone can
take one from their own SSO session — exactly what we need for per-user.

**5. There is no identity check before writing.** `whoami` prints both the actor and the
token owner but **does not warn when the two differ**
([src/commands/whoami.ts:50-57](../src/commands/whoami.ts)), and it has to connect before it can say
anything. Writing under the wrong name is a silent failure.

**6. `HULY_WORKSPACE_ID` is documented only as a UUID.** If someone takes an account token from the
SSO redirect URL (the kind not bound to a workspace) then `selectWorkspace` fails with
`WorkspaceNotFound` — because a UUID only works when the token is already bound to a workspace. Exactly the trap
the self-service path will hit.

**7. No tests, no CI.** Refactoring the credential layer without a safety net.

## Fix plan, ordered by value/cost

### P0 — required to reach the goal

**a. Make credentials an explicit parameter.** Add `resolveCredentials(source)`
returning `{ host, workspace, token }`; `HulyClient.connect(creds)` and
`withClient(creds, fn)` take it; `process.env` becomes just **one** source at the edge
(the CLI reads env, HTTP reads headers). Small change, but it unlocks everything after it.
Scope: `src/utils/auth.ts`, `src/client.ts:126-135`, `src/client.ts:838`.

**b. HTTP transport takes credentials per request — additive, not a replacement.** Header
`x-huly-token` (+ `x-huly-url`, `x-huly-workspace` if multi-instance). The shared token
in env **stays exactly as it is** as the default; the caller's token only overrides it when the header is present.

Priority order: request header → process env. Plus a
`HULY_REQUIRE_CALLER_TOKEN=true` flag so a deployment that wants to tighten up can go fail-closed
(missing header → `401`); **off** by default, so running configurations do not change behavior.

A requirement regardless of source: every response must state clearly **whose name the write is
under** (see P1-d), so that "falling back to the shared token" is a visible choice rather than
something that happens silently.

**c. Tests + CI for exactly this layer.** Four minimum cases: credential source
priority order; fail-closed when the header is missing; `maskToken` not leaking the token; no
token reaching stdout/stderr. Plus a workflow running `typecheck` + `test`.

### P1 — preventing writes under the wrong name

**d. Diagnostics without a connection.** `huly whoami --offline` / the `huly_context` tool:
decode the JWT payload locally (without verifying) to print `account`, `workspace`, host,
credential source. Catches 90% of config errors before touching Huly.

**e. Warn when `HULY_ACTOR` ≠ the token owner**, and state clearly in the README that
`HULY_ACTOR` is a **stopgap for a shared token**; once per-user is in place, drop it.
Do not remove it immediately, so running configurations do not break.

**f. Accept both a UUID and a URL slug for the workspace**, with a clear error: "this token is not
bound to a workspace → `HULY_WORKSPACE_ID` must be the URL slug". Plus a README section
walking each person through getting their own token via SSO.

### P2 — only if needed

**g. `exp` on admin-minted tokens.** Does not serve the per-user goal, it only reduces the risk of
permanent tokens. `jwt-simple` already enforces `exp` in `decode()`, so it works today on
0.7.423 if we want it.

## The realistic scope to do first

The current `.env` sets `HULY_MCP_TRANSPORT=stdio`. With stdio, **each person runs their own
process, so per-user is achieved simply by each person putting their own token into their MCP
config** — no need for P0-b. So the pragmatic order:

1. **P0-a** (parameterize credentials) + **P1-d/e/f** + **P0-c** → enough to roll out
   per-user on stdio right away, safely and with warnings when something is wrong.
2. **P0-b** (per-request headers) whenever we actually stand up a shared HTTP deployment.

Not doing: racing on tool count, renaming the repo, rewriting in Effect-TS, or waiting for Huly
to release PR #10624.
