# Changelog

Versions cover both `huly-skill` (CLI) and `@fioenix/huly-mcp` (MCP server),
which are released together under the same number.

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
