# Changelog

Versions cover both `huly-skill` (CLI) and `@fioenix/huly-mcp` (MCP server),
which are released together under the same number.

## 1.9.0

### Added — comments can be edited and deleted
- `huly comments update <messageId> "<body>"` / `huly_update_comment` and
  `huly comments delete <messageId> --yes` / `huly_delete_comment`. Reading
  comments has been possible since 1.5.0; fixing a wrong one meant opening Huly.
  Both address a comment by its `_id` and work on thread replies too, since the
  collection coordinates come off the stored document. An edit stamps `editedOn`
  the way Huly's own editor does, so a listing can tell an edited comment from an
  original one. Deletion is irreversible and needs `--yes` (`confirm=true` on
  MCP). MCP tool count 29 → 31; `tools/list` 18,264 B → 19,589 B.

### Added — exit status by error class
- The CLI exits `2` on `auth`, `3` on `not_found`, `4` on `invalid_input`, `5` on
  `connection`, and `1` on anything else, matching the `code` in JSON mode. A
  shell can now branch on `$?` without parsing output. Scripts that only test for
  nonzero are unaffected.
- Six failure paths — missing teamspace, missing document, missing task in
  `labels`/`delete` — printed a human line even under `--json`, so a JSON caller
  got nothing parseable. They now return the same envelope as every other
  failure.

## 1.8.0

### Fixed — the skill bundle shipped three versions stale
- `huly-skill.zip`, the archive uploaded to claude.ai as a Skill, still carried
  the pre-1.7 `SKILL.md` and none of `references/`. Nothing regenerated it
  because nothing owned it. `pnpm pack:skill` rebuilds it from
  `skills/huly-skill/` plus `bin/`, and `pnpm verify:release` now fails when the
  committed zip differs from either.
- The `dist/` directory — 36 files of `tsc` output from April, superseded by the
  esbuild bundles in `bin/` and already listed in `.gitignore` — was still
  tracked in git. Removed; nothing referenced it.

### Added — errors say whether retrying is worth it
- Every JSON failure now carries `code` and `retryable` beside the message it
  already had: `auth`, `connection`, `not_found`, `invalid_input`, `unknown`.
  Only `connection` is retryable. An agent previously had to infer that from a
  Vietnamese sentence, and both wrong guesses cost something — retrying a
  `not_found` burns turns, giving up on a dropped WebSocket loses work that
  would have succeeded. `auth` also carries a `hint` pointing at the offline
  diagnostics. The human message is unchanged, in both languages; the fields sit
  next to it.

### Added — release and integration checks
- `pnpm verify:release` checks the three manifests agree on the version and,
  more to the point, asks the binaries what they report: `huly --version` and
  the MCP `initialize` handshake, plus that `npm-package/huly-mcp.cjs` matches
  `bin/mcp.cjs` and that nothing but JSON-RPC reaches stdout. `--packed` repeats
  the last two against the tarball `npm publish` would upload. Every check
  corresponds to a release that went out wrong. CI runs it on every push.
- `HULY_SMOKE=1 pnpm smoke` runs create → read → list → comment → delete against
  a real workspace through the built CLI, and deletes the issue it created even
  when a step fails. Opt-in and deliberately outside CI, since it needs
  credentials and writes to a live workspace: the unit tests cover pure
  functions, this covers the half where an SDK change or a bundling mistake
  breaks a call that still typechecks.

## 1.7.0

### Changed — MCP list results are now capped and projected
- `huly_list_tasks`, `huly_list_projects`, `huly_list_users`, `huly_list_labels`,
  `huly_list_teamspaces`, `huly_list_documents` and `huly_list_milestones` return
  at most 50 rows, each trimmed to the fields callers actually read, instead of
  whole Huly documents. On a 249-task workspace `huly_list_tasks` drops from
  ~290 KB to ~20 KB — a tool result stays in the agent's context for the rest of
  the session, so the old default cost more than the entire tool catalogue.
  Every response now carries `count` (returned), `total` (matched) and
  `truncated`, so a cap is never silent. Pass `limit: 0` for no cap and
  `fields: "all"` for the previous behaviour — and `limit` on
  `huly_list_projects` now does what 1.6.1 noted it did not.
- Milestone listings omit `description`, which holds raw ProseMirror JSON rather
  than prose; request it explicitly through `fields` when needed.

### Added — tests and CI
- 30 tests over the parts where a silent mistake is expensive: output shaping
  (caps, projection, the `all` escape hatch), token claim decoding and the
  configuration warnings, and credential precedence including that a caller's
  token never leaks past its own request. They run on `node --test` through the
  `tsx` loader already in devDependencies — no test framework was added.
- A GitHub Actions workflow runs typecheck, tests, and a build that fails when
  the committed `bin/` bundles differ from source. Local MCP clients run
  `bin/mcp.cjs` from a checkout, so an uncommitted rebuild silently ships stale
  code to all of them; RELEASING.md warned about it, now CI enforces it. (The
  workflow file itself landed just after the v1.7.0 tag — `.gitignore`'s
  `**/.*/` rule had been excluding `.github/`, so it was never committed. Repo
  infrastructure only; the published package is unaffected.)

### Added — per-caller Huly credentials over HTTP
- The HTTP transport accepts `x-huly-token`, `x-huly-url` and `x-huly-workspace`
  per request, so several people can share one deployment and still have their
  writes attributed to them. Huly records the token's owner as author, which is
  why a shared token makes every task look like one person's.
- The process environment remains the default and unchanged: omit the headers
  and the server behaves exactly as before. `HULY_REQUIRE_CALLER_TOKEN=true`
  turns the fallback off and answers `401` when `x-huly-token` is missing, so a
  deployment that cares about attribution cannot silently write as the server.
- `huly_context` reports `credentialSource` (`request` or `environment`) and
  describes the credentials actually in scope.

### Added — offline diagnostics
- `huly_context` (MCP) and `huly whoami --offline` (CLI) report how the tool is
  configured without connecting: version, host origin, workspace, the masked
  token plus the account and workspace it is bound to, actor, proxy. They also
  name the problems that a connection error hides — a token that does not parse,
  a token bound to a different workspace than `HULY_WORKSPACE_ID`, an expired
  token, and the case where an unbound token needs a workspace URL slug rather
  than a UUID. The token itself is never returned.
- `huly whoami` warns when `HULY_ACTOR` resolves to someone other than the token
  owner: Huly attributes the write to the token owner regardless, so the two
  names disagreeing means every task is authored by the wrong person.

### Added
- `huly tasks --limit <n>` and `--fields <list>`. Both are opt-in: the CLI still
  returns every match with all fields by default, so existing shell pipelines are
  unaffected. `--fields all` is the explicit form of that default.

## 1.6.1

### Changed — may reject calls that previously succeeded
- The four tools that take no arguments (`huly_whoami`, `huly_list_projects`,
  `huly_list_labels`, `huly_list_teamspaces`) were left out of the strict
  validation added in 1.6.0, so they still discarded unknown arguments
  silently — `huly_list_projects` with `limit: 5` returned all 17 projects and
  reported success. All 28 tools now reject unrecognised arguments, and their
  advertised schemas carry `additionalProperties: false`.

### Fixed
- The Huly client's connection log (`Generate new SessionId …`, `init DB
  complete …`, `Connected to server: …`, `findfull model …`) went to stdout.
  That made `--json` output unparseable without stripping a four-line preamble,
  and put non-protocol lines on the MCP stdio channel, where stdout carries the
  JSON-RPC framing. Those messages now go to stderr; stdout carries only this
  project's own output.

### Changed
- All 26 `@hcengineering` packages now resolve to `0.7.423`. A lockfile from
  May held `api-client` and `core` at `0.7.19`/`0.7.26` while `activity` and
  `chunter` were already at `0.7.423`, so two copies of `core` were bundled.
- `tsc --noEmit` went from over ten minutes and seven errors to about one
  second and none: `moduleResolution` moved off `node10`, whose directory walk
  over the pnpm layout collapsed against zod's generics. From `0.7.423` the
  `@hcengineering` packages ship no type declarations while still pointing
  `"types"` at a missing path, so `src/hcengineering.d.ts` declares the surface
  this project imports.

## 1.6.0

### Added
- `huly create task --parent <id>` and `huly_create_task`'s `parentId` — create a
  task as a sub-issue of an existing one. Previously nothing could attach a task
  to a parent, and nothing re-parents a task after creation.
- `huly users` / `huly_list_users` — list workspace people with membership status
  and role, so `--assignee` has a discoverable source of ids.
- `HULY_ACTOR` — names the person operating a shared token: `me` resolves to them
  and created tasks carry a `Requested by: <name>` line. Huly issues tokens per
  (account, workspace) and its token screen is admin-only, so a team cannot get
  one token each and every caller would otherwise appear as the token's owner.
  This is a label, not authentication.
- `HULY_DEFAULT_ASSIGNEE` — assignee used when `--assignee` is omitted.
- `huly whoami` reports the configured actor and default assignee, and fails
  loudly when the actor name does not resolve.

### Fixed
- `huly_create_task` took `parent` while `huly_list_tasks` took `parentId`.
  Passing `parentId` to create returned `status: ok` and produced a *top-level*
  task — the unknown key was dropped and the parent silently lost. `parentId` is
  now the primary name on both, with `parent` kept as an alias.

### Changed — may reject calls that previously succeeded
- Tool arguments are validated strictly: an unrecognised argument is now an
  error instead of being silently discarded. This affected every tool, not just
  the one above — a mistyped filter used to return unfiltered results, and a
  mistyped field used to report a successful update that changed nothing. Calls
  relying on that behaviour were already producing wrong results, but they did
  not fail, and now they will.

## 1.5.0

### Added
- `huly kinds --project <id>` and `huly_list_task_kinds` — list the task types
  (Task, Bug, EPIC, KPI, …) of a project. Task types are scoped by project
  type, so the same name can carry different ids across projects; the lookup
  takes a project to keep the returned ids valid for the caller's target.
- `huly comments list <objectId>` and `huly_get_comments` — read comments on
  any object by internal `_id` (issue, milestone, document, …), not just
  issues. Thread replies are nested under `replies`.
- `huly comments get <messageId>` and `huly_get_comment` — read a single
  comment by its `_id`, the `message` parameter of a chunter link.
- Comment authors resolve to person names via social identities.

### Changed
- `kindId`, `componentId` and `milestoneId` MCP arguments now carry
  descriptions pointing at the tool that produces them; previously they were
  bare strings with no discoverable source.
- Example agent configs for Claude, Antigravity and Codex under
  `examples/agents/`.

### Fixed
- The MCP server reported `version: 1.2.0` in its `initialize` handshake
  regardless of the released version — hardcoded and never bumped since 1.2.0.
  It now reports the real version.
- `comments get` exits nonzero when the comment id is not found, so scripts no
  longer read a missing comment as success.
- Replies whose parent falls outside the requested `--limit` are no longer
  appended as detached top-level entries.

Note: 1.4.0 was set in the repository but never tagged or published; 1.5.0 is
the first release after 1.3.0.

## 1.3.0

### Added
- `huly sub-issues <id>` — recursive sub-issue tree.
- `huly task-by-id <_id>` — lookup by internal `_id`.
- `huly tasks --parent` / `--milestone-id` filters.
- `huly milestones report <id>` — issues grouped by Epic.
- `huly activity <id>` — `DocUpdateMessage` + `ChatMessage` timeline.
- MCP counterparts: `huly_list_sub_issues`, `huly_get_task_by_id`,
  `huly_milestone_report`, `huly_get_activity`; `huly_list_tasks` gains
  `parentId` and `milestoneId`.

## 1.2.0 and earlier

Released before this changelog existed (`1.1.0`, `1.2.0`); see the git history
for details.
