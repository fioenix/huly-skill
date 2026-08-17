# Setup — credentials and sandbox

## Environment variables

The CLI reads these from a `.env` file; it never needs them passed inline.

- `HULY_HOST` — Huly instance URL, e.g. `https://huly.app`
- `HULY_WORKSPACE_ID` — workspace UUID (Huly Settings → Workspace). A workspace
  **URL slug** also works, and is required when the token is not bound to a
  workspace (see below).
- `HULY_API_KEY` — API token: a JWT binding one account to one workspace
- `HULY_ACTOR` — optional; who is operating the CLI when the token is shared
- `HULY_DEFAULT_ASSIGNEE` — optional; assignee used when none is given

## Where `.env` is looked up

First match wins:

1. `~/.huly/.env` — primary; works everywhere and survives the Cowork sandbox
2. The skill directory (next to `SKILL.md`) — for Claude Desktop / direct install
3. The working directory

Before the first command, check `~/.huly/.env` has all three required vars. If
not, ask the user for the values and write them:

```bash
mkdir -p ~/.huly
cat > ~/.huly/.env << 'ENVEOF'
HULY_HOST=https://huly.app
HULY_WORKSPACE_ID=<uuid-or-slug>
HULY_API_KEY=<token>
ENVEOF
```

Write to `.env` rather than passing values inline: inline arguments are visible to
anything that can read the process list (`ps aux`) and don't survive the session.
`~/.huly/` stays writable even when the skill directory is read-only.

## Where the token comes from

Two working routes. Which one applies depends on how the workspace signs people in.

**The user's own session token (no admin needed).** Every member already has a
token after logging in — including via Google SSO or OIDC, and 2FA does not block
this path. It can be read from the browser: the `presentation-metadata-Token`
cookie, or the WebSocket request URL (`wss://<transactor>/<JWT>`), or the
`?token=` parameter on the `/login/auth` redirect right after SSO. This is the
route that gives correct attribution, because the token is that person's.

**Workspace settings → General → Generate API token.** That screen is restricted
to workspace **Owners**, and what it hands back is the Owner's own session token —
not a separate credential. On a team, a token issued this way makes every action
look like the Owner's.

Caveat when copying from the SSO redirect URL: that token carries an account but
no workspace, so `HULY_WORKSPACE_ID` must be the workspace **URL slug**, not the
UUID. A UUID only works with a token that already has a workspace bound.

Longer analysis, including what tokens cannot do (no expiry, no per-token
revocation on current releases): [`reference/huly-auth.md`](../../../reference/huly-auth.md).

## Claude Cowork sandbox

The sandbox routes network traffic through a local proxy and wipes its filesystem
at the end of the session.

**Proxy** — export once per session:

```bash
export HTTPS_PROXY=http://127.0.0.1:3128
```

The CLI detects `HTTPS_PROXY` and patches both `fetch` and the WebSocket
connection. Don't rely on `NODE_USE_ENV_PROXY` — Node still performs a local DNS
lookup that fails inside the sandbox.

**Persisting credentials** — because the filesystem is ephemeral, `~/.huly/.env`
must live on a directory mounted from the user's machine. Before the first
command, mount `~/.huly` with the Cowork directory tool
(`mcp__ccd_directory__request_directory`), wait for confirmation, then check or
create `.env` there as above. Later sessions only need the mount; the credentials
are already saved.

For heavy Cowork use the Huly MCP server is a smoother fit than this CLI skill:
its HTTP transport runs outside the sandbox, so there is no proxy to fight and no
directory to mount. This skill stays the zero-install option for Claude Code and
Claude Desktop.

## If the binary is missing

`bin/huly.cjs` ships inside the skill directory. If it is absent the install is
incomplete — ask the user to reinstall from
https://github.com/fioenix/huly-skill
