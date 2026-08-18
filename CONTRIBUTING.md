# Contributing

Thanks for taking the time. This project stays deliberately small — a lean CLI
and MCP server over Huly's API, readable end to end in one sitting — so the
guidance below is mostly about keeping it that way.

## Getting set up

```bash
pnpm install
cp .env.example ~/.huly/.env   # then fill in HULY_HOST, HULY_WORKSPACE_ID, HULY_API_KEY
pnpm build
```

`pnpm` is what the lockfile was produced with. Node 20 is the floor for running
the published bundles; the repo's own tooling wants Node 22, because pnpm 11
imports `node:sqlite`.

## Before opening a pull request

```bash
pnpm typecheck
pnpm test
pnpm build            # bin/ is committed — see below
pnpm verify:release
```

CI runs exactly these. Two things catch people out:

- **`bin/` is committed on purpose.** Local MCP clients run `bin/mcp.cjs` from a
  checkout rather than from npm, so a rebuild that is not committed ships stale
  code to every one of them. CI fails if the tree is dirty after a build.
- **`huly-skill.zip` is committed too**, and `pnpm pack:skill` regenerates it.
  `pnpm verify:release` fails when it no longer matches its sources.

For changes to a write path, run the integration smoke test against a workspace
you do not mind writing to. It creates one issue and deletes it again, including
when a step fails midway:

```bash
HULY_SMOKE=1 pnpm smoke
```

## What this project says yes and no to

- **Yes** to a tool or command someone actually needs. **No** to adding surface
  for coverage's sake: every MCP tool costs context in every session that loads
  the server, whether or not it is called.
- **Yes** to results that stay small by default. List results are capped and
  projected because a tool result stays in an agent's context for the rest of the
  session.
- **No** to speculative abstraction, configurability nobody asked for, or a
  dependency that replaces something the standard library already does. Tests run
  on `node --test`; there is no test framework and no linter.
- Match the surrounding style rather than your own. Comments explain *why*.
- English only, in code, comments, output, and documentation.

`evals/evals.json` holds prompts used to check that the skill triggers on the
right requests; add one when you add a command an agent should reach for.

`reference/` holds the reasoning behind the decisions above, including an ADR for
the WebSocket transport and a criterion-by-criterion comparison against the other
Huly MCP server. Read the relevant note before proposing to reverse one of them —
and if you have evidence the decision was wrong, that note is the right place to
argue it.

## Dependencies

Three of them are pinned to this package's **Node floor**, not to their latest
release: `commander` 15 requires Node 22.12, `undici` 8 requires 22.19, and
`@types/node` must describe the *oldest* runtime supported — typing against a
newer Node lets an API that crashes on the floor version pass `pnpm typecheck`.
`.github/dependabot.yml` ignores major bumps for those three; revisit all of them
together when the floor moves.

The `@hcengineering` packages must match the Huly server version they talk to.
1.6.1 shipped two copies of `core` because they had drifted.

## Commits and pull requests

- Commit messages start with a verb: `Add`, `Fix`, `Refactor`, `Update`. One
  logical change per commit.
- Say what breaks. `CHANGELOG.md` gives anything that can reject a call that
  previously succeeded its own heading saying so.
- Never commit secrets. `~/.huly/.env` lives outside the repo for that reason.

## Security

Please do not open a public issue for a vulnerability — see
[SECURITY.md](./SECURITY.md).
