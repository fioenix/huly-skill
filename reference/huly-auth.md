# Huly authentication — research (17/08/2026)

Scope: Huly platform's authentication mechanisms, checked against the instance we use
(`https://work.yody.io`, version **0.7.423**, self-hosted) and against what
`huly-skill` currently does in [`src/client.ts`](../src/client.ts).

**Real constraints at YODY** (supplied by the user, and they determine the whole
recommendation section): everyone **signs in via Google SSO**, and **2FA is on**. So the
`login(email, password)` flow is unusable — everything below accounts for that constraint.

Sources: source code read directly — `@hcengineering/api-client@0.7.423`,
`@hcengineering/account-client@0.7.423`, `@hcengineering/client-resources@0.7.423`
(in `node_modules`), and `hcengineering/platform` at tag `v0.7.423` plus the `develop` branch.

---

## 1. Authentication architecture

| Component | Role | URL on the YODY instance |
|---|---|---|
| Front / config | serves `/config.json` containing service endpoints | `https://work.yody.io/config.json` |
| Account service | issues and signs JWTs, manages accounts/workspaces/roles | `https://huly-account.yody.io` |
| Transactor (WS) | receives the JWT over WebSocket, executes transactions | endpoint returned by `selectWorkspace` |

The `connect()` flow in `@hcengineering/api-client`:

1. `loadServerConfig(host)` → get `ACCOUNTS_URL`.
2. `getWorkspaceToken()`: `{ email, password }` → calls `login()` to get an **account token**;
   or `{ token }` → used as-is.
3. `selectWorkspace(workspace)` → exchanges it for a **workspace token** + `endpoint`.
4. Open the WebSocket: the URL is `wss://<transactor>/<token>` — the token is **in the path**
   (`client-resources/src/index.ts:104`).

## 2. What the token is

An `HS256` JWT, signed with the `SERVER_SECRET` shared between services
(`foundations/core/packages/token/src/token.ts`):

```
{ account, workspace?, extra?, grant?, sub?, exp?, nbf? }
```

- `extra` — free-form metadata: `admin: 'true'`, `authMethod: 'password'|'otp'`,
  `service`, `readonly: 'true'`, `apiTokenId`, `guest`.
- `grant` — `PermissionsGrant`: `{ workspace, role, spaces?, grantedBy? }`. With
  `grant` but no `sub`, `nbf` + `exp` are **mandatory**.
- `exp` / `nbf` — `jwt-simple@0.5.6` checks them right inside `decode()`
  (`package/lib/jwt.js:97-102`), so expiry **is enforced even on 0.7.423**.
  No `exp` = alive until `SERVER_SECRET` changes.

**There are two kinds of token; do not confuse them:**

| | Account token | Workspace token |
|---|---|---|
| Payload | `{ account }`, **no** `workspace` | `{ account, workspace }` |
| Source | `login()`, SSO redirect, `validateOtp()` | `selectWorkspace()` |
| Usable for `connect()`? | **only if** you pass `workspace` = the **URL slug** | ✅ (UUID works too) |

Reason: `selectWorkspace` looks the workspace up with `getWorkspaceByUrl(url)`; if that
misses it falls back to `getWorkspaceById(decodedToken.workspace)`
(`server/account/src/utils.ts:733+`). `HULY_WORKSPACE_ID` is a UUID, so it only works
because the current token is **already bound to a workspace**. Switching to an account token
(for example one copied from the SSO redirect) means changing the variable to the **workspace URL slug**,
otherwise you get `WorkspaceNotFound`.

**The current token in `.env`**: `extra` is an empty `{}`, no `exp`, no `nbf`,
no `grant` — matching `generateToken(account, workspace, {})`, i.e. produced by the
Settings screen or by `dev/tool generate-token` (without `--admin`). It is a
**permanent credential that cannot be revoked individually**.

## 3. Google SSO + 2FA: what actually happens

**Huly's 2FA does not apply to SSO.** `loginOrSignUpWithProvider`
(`server/account/src/utils.ts:1521`) — the function both `/auth/google` and `/auth/openid`
reach via `handleProviderAuth` — ends with:

```ts
token: generateToken(personUuid, undefined, extraToken)
```

There is no `tfaSecret` branch anywhere. By contrast: `login()` (password) and
`validateOtp()` both mint a token with `account = NIL_UUID` + `extra.tfaAccount` when the
account has a `tfaSecret`, and that token **cannot** `selectWorkspace` until it passes
`verify2fa(code)`. Additional check on the `develop` branch: `utils.ts` contains **0**
occurrences of `tfaSecret` — meaning Huly has never gated SSO with TOTP; this is not
specific to 0.7.423.

Two-sided consequence:

- *Operationally, good for us*: 2FA is **not** a barrier to obtaining a per-person
  token. Once someone signs in with Google they already have a full token.
- *Security-wise, worth knowing*: if YODY treats TOTP as a mandatory second factor, that
  assumption **does not hold** for the Google/OIDC path — the actual second factor is
  Google Workspace MFA, not Huly's.

**Where an SSO user's token lives** (3 places, all readable by the owner):

1. The redirect URL after Google returns: `.../login/auth?token=<JWT>`
   (`pods/authProviders/src/utils.ts:115`) — this is an **account token**.
2. The `presentation-metadata-Token` cookie, scope `/files/<workspaceUuid>`
   (`packages/presentation/src/utils.ts:893`) — a **workspace token**.
3. Network tab → WebSocket request: `wss://<transactor>/<JWT>` — a **workspace token**.

## 4. Four ways to get a token — against the SSO + 2FA constraint

| Method | Works with SSO+2FA? | Who can do it | `exp` | Revocable | Present in 0.7.423 |
|---|---|---|---|---|---|
| `login(email, password)` | ❌ no password; 2FA blocks it | — | ❌ | ❌ | ✅ |
| OTP (`loginOtp`/`validateOtp`) | ❌ 2FA blocks it (returns `NIL_UUID`) | — | ❌ | ❌ | ✅ |
| Copy your own session token after SSO | ✅ | any member | ❌ | ❌ | ✅ |
| Settings → General → *Generate API token* | ✅ | **Owner** only | ❌ | ❌ | ✅ |
| `dev/tool generate-token` / a `generateToken` script | ✅ (bypasses everything) | admin with shell + DB | ⚠️ a script can | ❌ | ✅ |
| `createApiToken` (revocable API token) | ✅ | any member ≥ `User` | ✅ 1–365 days | ✅ | ❌ **`develop` only** |

**The Settings button does not create an API key.** `General.svelte:156` only calls
`accountClient.selectWorkspace(workspaceUrl)` and prints the result in a popup — it is **the session
token of the Owner who clicked it**. The screen is gated on `role: AccountRole.Owner`
(`models/setting/src/index.ts:284`). So the "admin-only" fence is a **UI** fence, not a
system one: the token it returns is no better than the token any member can pull
out of their own session (section 3).

**Revocable API tokens** — `createApiToken` / `listApiTokens` / `revokeApiToken`:
self-service from the `User` role, 1–365 day expiry, at most 100 live tokens per account, revocable,
and the transactor checks revocation via `verifyToken()` with a 60s cache TTL. Commit
`5a3d673e` dated 04/08/2026 (PR #10624), already on `develop` but **not in any tag**
(`v0.7.432` is the latest tag and still does not have it), and npm `account-client@0.7.423` does not
expose it. **Important for YODY**: this flow authenticates with an existing session token, so
it works equally well with SSO — this is the right destination, it just is not released yet.

## 5. Access links — the path that gets overlooked

`createAccessLink(role, { spaces, nbf, expiration, personalized, extra })` mints a
token for `GUEST_ACCOUNT` with a `grant`. This is **the only mechanism in 0.7.423 that lets
a token both expire and be scope-limited** (`spaces`). Trade-off: the account
is a shared guest → activity is not attributed to a real person, and the maximum role is capped by the
role of whoever created the link. Suitable for narrow read-only integrations, unsuitable for an agent that writes data.

## 6. Other protection layers on the account service

- **2FA (TOTP)**: `generate2faSecret` / `enable2fa` / `verify2fa` / `disable2fa`
  — only effective on the password and OTP paths (section 3).
- **Password lockout**: `isAccountPasswordLocked` + `recordFailedLoginAttempt`;
  the error returned is `AccountNotFound` (no distinction between wrong password and no account).
- **Password aging**: `passwordAgingRule` (in days), set at the workspace level.
- **Read-only guest**: if a workspace enables `allowReadOnlyGuest`, a wrong/missing token can still
  `selectWorkspace`, receiving `role = ReadOnlyGuest` + `extra.readonly = 'true'`.
- **SSO on the YODY instance**: `GET https://huly-account.yody.io/providers` →
  `[{ google }, { openid, displayName: "Yody" }]`.
- **`extra.admin === 'true'`**: skips the membership check, and `selectWorkspace` grants
  the `Admin` role outright (`server/account/src/utils.ts:830`). `tool generate-token --admin`
  produces this kind — it is a key to the whole system, do not use it for an agent.

## 7. Risks in the current setup

1. **The token never expires and cannot be revoked.** Invalidating it requires changing
   `SERVER_SECRET` → killing everyone's sessions.
2. **A shared token means wrong attribution.** Huly records the author from the social ID of the
   account in the token; `HULY_ACTOR` is only a text label.
3. **The MCP HTTP transport holds a Huly credential.** `HULY_MCP_AUTH_TOKEN` is the only bearer
   guarding `POST /mcp`; past it you have the full rights of the token underneath.
4. **The token sits in `.env` in plaintext** (already `.gitignore`d, confirmed with `git check-ignore`),
   but every process the user runs can read it.

## 8. Recommendation (accounting for SSO + 2FA)

**Option 1 — an admin mints per-person tokens with a script, with `exp`.**
We self-host so we hold `SERVER_SECRET`; write a ~20-line script calling
`generateToken(accountUuid, workspaceUuid, {}, SECRET, { exp })` — one token per
person, 30–90 day expiry, correct attribution. It bypasses SSO/2FA because minting happens server-side, so
the Google SSO constraint is irrelevant. The price: the admin must re-run it on rotation,
`SERVER_SECRET` leaves the server's boundary (and must be treated as a first-class secret),
and **there is no revocation** — only expiry.

**Option 2 — each person copies their own session token after signing in with Google.**
No admin needed, no code needed, works today. The price: the token never expires and
cannot be revoked (logging out does **not** invalidate it); if copied from the redirect URL it is
an account token → `HULY_WORKSPACE_ID` must change to the **workspace URL slug** (section 2);
and walking a whole team through pulling a JWT out of DevTools is an error-prone, leak-prone process.

**Option 3 — upgrade the self-host to a build containing PR #10624 and use revocable API tokens.**
The most correct and most SSO-friendly. No released tag has it → either build from `develop`
(carrying the risk of running an unreleased branch in production), or wait.

**Proposal: Option 1 now, Option 3 as the destination.** Reason: it is the only approach that
survives SSO+2FA, gives correct attribution, and has an expiry — without making
the whole team do DevTools work. Option 2 should only be a stopgap for 1–2 people
while the script is being written. When Option 3 ships we swap the credential without touching the
architecture, because all three go through the same `ConnectOptions`.

What to do if we pick Option 1: a token-minting script (input: email → social ID → account
UUID), an expiry convention, and a rotation schedule. `huly-skill`'s code **needs no changes** — it is still
`HULY_API_KEY`, just a different value per person.

## 9. What needs fixing in the README

- The Settings → General button is described as an "API access token"; more precisely: it returns
  **the Owner's session workspace token**, it does not create a separate credential.
- The sentence "latest release expose no token-creation call" needs a version anchor: true for
  `0.7.423`, but `develop` already has `createApiToken` (PR #10624).
- Should be added: for a workspace using SSO, `HULY_API_KEY` can be taken from the user's
  own session, and if it is an account token then `HULY_WORKSPACE_ID` must be the URL
  slug, not the UUID.
