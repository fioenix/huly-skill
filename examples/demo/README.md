# First read-only Huly demo

## Preview without an account

From the repository root, with Node.js 20.18.1+:

```bash
node examples/demo/replay.mjs
```

This prints [`tasks.json`](./tasks.json), an invented response in the CLI's JSON
format. It does not invoke the CLI, read environment files, access a network, or
create a workspace. It illustrates the output shape, not a live integration test.
The two `DEMO-*` issues and their titles are synthetic.

## Try the equivalent read on your workspace

Follow the [quickstart](../../README.md#quickstart-read-only) to configure your own
credentials outside the repo, then run:

```bash
node bin/huly.cjs whoami --offline
node bin/huly.cjs whoami
node bin/huly.cjs tasks --assignee me --limit 5 --fields identifier,title --json
```

The last command lists active tasks for `me`. The result uses your workspace's
identifiers and titles; it will differ from the fixture. `me` resolves to
`HULY_ACTOR` when set, otherwise to the token owner. An empty `data` array is a
valid result. `count` is returned rows, `total` is matched rows, and `truncated`
means the limit hid some rows. These are read operations, but the token still has
its owner's permissions.

## Try with an agent

After installing the [skill or MCP server](../agents/README.md), ask:

> Use Huly to list at most five tasks assigned to me, returning only identifiers
> and titles. Do not create, update, or delete anything.

The CLI command above is the skill route. The MCP route is `huly_list_tasks`:

```json
{ "assignee": "me", "limit": 5, "fields": "identifier,title" }
```

Do not paste real tokens or real workspace output into screenshots, public
issues, demos, or release notes. Use the fixture for anything shared publicly.
