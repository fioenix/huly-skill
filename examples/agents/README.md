# Per-agent integration templates

The Huly capabilities ship two ways. Pick per agent:

| Agent | Path A — Skill instructions | Path B — MCP server |
|-------|-----------------------------------|---------------------|
| **Claude Code** | `npx skills add fioenix/huly-skill --skill huly-skill --agent claude-code` | [`claude.mcp.json`](./claude.mcp.json) → project `.mcp.json` or `claude mcp add` |
| **Antigravity** | copy `skills/huly-skill/` → `<project>/.agents/skills/huly-skill/` | [`antigravity.mcp_config.json`](./antigravity.mcp_config.json) → `~/.gemini/config/mcp_config.json` |
| **Codex** | `npx skills add fioenix/huly-skill --skill huly-skill --agent codex` | [`codex.config.toml`](./codex.config.toml) → `~/.codex/config.toml`; usage from [`AGENTS.md`](../../AGENTS.md) |

Replace the three `HULY_*` placeholders with your workspace credentials before use. The MCP server (`@fioenix/huly-mcp`) is single-workspace: one credential set, shared by all callers.

Both the Skill and the MCP server expose the **same** operations and return the same `{ "status": "ok" | "error", ... }` envelope — choose by what your runtime supports, not by capability.

The installer copies the skill instructions and references, not the CLI bundle at
the repository root. Follow the [read-only quickstart](../../README.md#quickstart-read-only)
for the cloned CLI, or install the complete `huly-skill.zip` (which includes
`bin/`) into your agent's skill directory. Codex discovers project skills under
`.agents/skills`; see its [official skill guide](https://developers.openai.com/codex/skills/).

A first agent prompt can be: “Use Huly to list at most five tasks assigned to me,
returning only identifiers and titles. Do not create, update, or delete anything.”
For MCP, call `huly_context` for an offline configuration check, then
`huly_whoami` and `huly_list_tasks` with `assignee: "me"`, `limit: 5`, and
`fields: "identifier,title"`. Keep the outputs private if using a real workspace.
