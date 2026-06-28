# Per-agent integration templates

The Huly capabilities ship two ways. Pick per agent:

| Agent | Path A — Skill (zero-install CLI) | Path B — MCP server |
|-------|-----------------------------------|---------------------|
| **Claude** | `npx skills add fioenix/huly-skill` → `.claude/skills/huly-skill/` | [`claude.mcp.json`](./claude.mcp.json) → project `.mcp.json` or `claude mcp add` |
| **Antigravity** | copy `skills/huly-skill/` → `<project>/.agents/skills/huly-skill/` | [`antigravity.mcp_config.json`](./antigravity.mcp_config.json) → `~/.gemini/config/mcp_config.json` |
| **Codex** | — (no skill system) | [`codex.config.toml`](./codex.config.toml) → `~/.codex/config.toml`; usage from [`AGENTS.md`](../../AGENTS.md) |

Replace the three `HULY_*` placeholders with your workspace credentials before use. The MCP server (`@fioenix/huly-mcp`) is single-workspace: one credential set, shared by all callers.

Both the Skill and the MCP server expose the **same** operations and return the same `{ "status": "ok" | "error", ... }` envelope — choose by what your runtime supports, not by capability.
