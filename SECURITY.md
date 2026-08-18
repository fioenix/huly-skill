# Security policy

## Supported versions

The latest released minor version is the only one that receives fixes. See
[CHANGELOG.md](./CHANGELOG.md) for what that currently is.

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/fioenix/huly-skill/security/advisories/new),
or by email to the address on the maintainer's GitHub profile. Please do not open
a public issue.

Include what you did, what happened, and the version (`huly --version`). A
proof-of-concept helps, but a clear description is enough to start. Expect an
acknowledgement within a week.

## What this project handles

The CLI and the MCP server hold a Huly API token with the full rights of the
account that issued it. Anything that leaks, logs, or widens the use of that
token is in scope, in particular:

- a token reaching stdout, stderr, a log line, an error message, or a tool result
- credentials from one HTTP caller leaking into another caller's request
- the HTTP transport accepting a request it should have rejected
- a command sending workspace data anywhere other than the configured host

Huly's own server, the `@hcengineering` packages, and the workspace's access
model are upstream — report those to the Huly project. Note that a token is
opaque to this project: it is passed through, and its payload is only ever
decoded locally, without verification, to describe the configuration.

## Known transitive advisories

`pnpm audit` reports advisories in this project's dependency graph that are not
fixable here, and this project does not pretend otherwise.

Every advisory that reaches a **shipped bundle** is closed, by forcing a patched
version through `overrides` in `pnpm-workspace.yaml` where upstream has not moved.
`pnpm audit:shipped` enforces that on every push: it rebuilds both bundles, maps
each input back to its package, and fails if a vulnerable package is actually
inside `bin/mcp.cjs` or `bin/bundle.cjs`.

The advisories that remain are in packages present at build time and absent at run
time — `svelte` and `dompurify` (Svelte UI components inside
`@hcengineering/activity` and `chunter`), `hono` and `ip-address` (the MCP SDK's
own HTTP server, unused here because this project runs `express`). None of them
are in either bundle, and the `@hcengineering` packages cannot be moved
independently: they must match the Huly server version.

The triage, the evidence, and the reasoning are in
[reference/security-audit-2026-08.md](./reference/security-audit-2026-08.md).

## Handling credentials safely

- Keep credentials in `~/.huly/.env`, never inline in a command or a config file
  that gets committed.
- A Huly token carries the rights of its owner and, unless it was minted with an
  expiry, does not expire. Treat a shared token as a shared password.
- `huly whoami --offline` and the `huly_context` tool describe the configured
  credential without connecting, and never return the token itself.
