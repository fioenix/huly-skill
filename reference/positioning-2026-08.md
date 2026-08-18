# Positioning `huly-skill` — strengths/weaknesses, renaming, and the health of Huly

Date: 17/08/2026. Three questions: (1) where are we strong and weak against `@firfi/huly-mcp`,
(2) should we rename to `huly-mcp`, (3) is Huly still being developed.
Detailed competitor review: [review-firfi-huly-mcp.md](./review-firfi-huly-mcp.md).

---

## 1. Strengths / weaknesses — both sides

### Where we are strong (with measurements)

| Strength | Evidence |
|---|---|
| Small surface, one person reads all of it | 4,565 LOC vs 89,614; 28 tools vs 522 |
| Low context cost in native mode | `tools/list` 15,721 B ≈ 3,930 tokens (measured) |
| Bundle ~2.9x smaller | npm unpacked 2.9 MB vs 8.4 MB |
| SDK matches the server version | `api-client@0.7.423` ↔ server `0.7.423`; they pin `0.7.19` + a self-maintained patch |
| Markup/collab free from the SDK | the WS `PlatformClient` has `MarkupOperations`; they had to rebuild it ([ADR-0001](./adr-0001-websocket-transport.md)) |
| Understanding of Huly's SSO/2FA path | [huly-auth.md](./huly-auth.md); their README does not mention SSO |
| CLI + agent skill + Vietnamese | `bin/huly.cjs`, `skills/huly-skill/SKILL.md` — they are MCP-first |

### Where we are weak

| Weakness | Evidence | Severity |
|---|---|---|
| No tests, no CI | 0 test files, 0 workflows vs 1,232 tests + a quality gate | **high** |
| MCP HTTP holds one shared credential | they take `x-huly-url`/`x-huly-workspace`/`x-huly-token` per request | **high** |
| Nobody uses it | 39 npm downloads/month vs 4,892; 0 stars vs 46 | medium |
| No distribution channels | they have Docker, Smithery, Glama, MCP registry, own site | medium |
| Weak diagnostics | `huly_whoami` must connect before it can say anything; they have `get_huly_context` needing no connection | medium |
| Narrow domain coverage | no drive, boards, mail, calendar, recruiting, inventory… | low (not needed yet) |
| Heavy bootstrap | `fake-indexeddb`, `window` polyfill, `console.log` redirect | low (the price of ADR-0001) |

### Their strengths / weaknesses

Strengths: 522-tool coverage, 1,232 tests + CI, multi-tenancy via headers, a `proxy` tool mode
to avoid blowing up context, a certification harness that prints no secrets, wide distribution, 4,892
downloads/month.

Weaknesses: 89,600 LOC + Effect-TS for a wrapper (huge cognitive cost, signs of generation
by an agent loop — `RALPH.md`); bus factor = 1; SDK pinned at `0.7.19`, 400+ patches behind
the 0.7.423 server, requiring a self-maintained patch; no guidance for SSO/2FA; 522 tools
are 522 surfaces that can be wrong.

### Straight reading

On the axis of **engineering discipline and adoption, we clearly lose**. On the axis of **compact,
version-matched, deep auth understanding, a CLI + Vietnamese skill, we win**. "Lean" is
a scope choice, not a virtue in itself: with our lean, the *user* pays
when a new domain is needed; with their lean, the *agent* pays in context or in a discovery
round-trip.

## 2. Should we rename to `huly-mcp`? — **No**

Reasons, in order of weight:

1. **A head-on name collision with a project that came 6 weeks earlier and is used 125x more.**
   Their repo is named `huly-mcp`, npm `@firfi/huly-mcp`, already in the MCP registry,
   Smithery, Glama. We arrive later with the same name → we lose on discovery and get read as a copy.
2. **We already have an MCP identity.** Our npm package is `@fioenix/huly-mcp` v1.6.1,
   binary `huly-mcp`. People installing MCP do not type the repo name. Renaming the repo helps
   discovery not at all, it only breaks old links.
3. **"Skill" is the real differentiator.** We are CLI + agent skill + MCP; they are MCP-first.
   Dropping the word "skill" erases our differentiator to take a name that already has an owner.
4. **The cost of renaming lands at exactly the wrong time.** See section 3.

If we want to emphasize MCP without renaming: change the repo `description` and the README headline
to something like "Huly MCP server + CLI + agent skill", keeping the name `huly-skill`.

## 3. Is Huly still being developed? — Yes, but it has dropped to maintenance mode

Measurements from `hcengineering/platform` (17/08/2026):

- **Commits/week, last 52 weeks** (old → new): `44 55 63 70 77 89 105 150 85 63 69
  15 15 36 41 14 15 20 9 24 30 23 17 18 21 11 25 24 18 23 23 32 15 25 15 15 12 18 5
  11 3 4 1 5 8 21 11 6 5 5 1 1`. That is, from **100–150/week** a year ago down to
  **1–10/week** over the last ~12 weeks.
- Most recent commit: **11/08/2026**. The repo is **not** archived; 27.4k stars, 2,107 forks,
  846 open issues.
- Still committing (since 01/06/2026): Artyom Savchenko (14), Alexander Onnikov (5),
  Denis Bykhov (4) — the core team is still there, just with less work.
- **Hosted Huly (huly.app) shut down ~20/07/2026** because "hosting is no longer being
  funded" (announced at the top of the platform README). Self-hosted is **not** affected →
  `work.yody.io` is fine.
- The README says the platform now underpins several products, "including Huly and **TraceX**"
  (tracex.co) — the commercial energy appears to have shifted there.
- The org has scattered into many small repos (hulypulse, hulykvs, huly.net, hulyrs, hulylake…),
  most last pushed in 2025.

**The killer detail for us — npm publishing has stopped:** `@hcengineering/core` (and the whole SDK)
was last published to npm at **0.7.423 on 10/05/2026**. Meanwhile tags `v0.7.426`
(03/07) and `v0.7.432` (16/07) **shipped but were never published to npm**. Three months
with no new npm release.

### Direct consequence for the "Option 3" decision

Last round we settled on: wait for a release containing PR #10624 (revocable API tokens) and
switch to it. With this data, **the probability of that happening in the next few months is
low**: PR #10624 sits on `develop`, is in no tag, and even existing tags no longer
reach npm. Waiting indefinitely is not a plan.

Three paths, and who pays for each:

1. **Option 1 (mint tokens with `exp` using `SERVER_SECRET`)** — does not depend on what Huly
   releases. `jwt-simple` already enforces `exp` right in `decode()`, so expiry does
   work on 0.7.423. No revocation, only expiry → compensate with a short lifetime
   (30 days). Price: the admin must rotate; `SERVER_SECRET` must be handled as a first-class secret.
2. **Build the self-host from `develop`** to get revocable tokens sooner. Price: running an unreleased
   branch in production, and taking on image builds ourselves — with a platform
   on life-support maintenance, that risk grows over time.
3. **Wait** — only reasonable if Huly resumes publishing to npm. Needs a check-in date, not
   an open-ended wait.

**Recommendation: take Option 1, and schedule a monthly check on npm `@hcengineering/core`.**
If there is still no new release in three months, treat the SDK as frozen at 0.7.423 and
hard-pin it, expecting no upgrade.

### Three things to do because Huly slowed down, not in spite of it

1. **Hard-pin dependencies + commit the lockfile** (`pnpm-lock.yaml` already exists) and state clearly
   in the README that the SDK stops at 0.7.423 — so nobody debugs blind later.
2. **Tests + CI**: when upstream patches little, regressions are our problem. This is the biggest
   gap against them, and its value rises exactly as upstream slows.
3. **Per-request credentials for the HTTP transport**: removes the "one shared token" risk,
   independent of any Huly version.

Not proposing: renaming, racing on tool count, or rewriting in Effect-TS.
