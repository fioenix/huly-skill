# Huly Assist Skill

> **Note:** This repository is structured as an [Anthropic-compatible Agent Skill](https://github.com/anthropics/skills) and aligns with the [Vercel Labs Skill Ecosystem](https://github.com/vercel-labs/skills). 

It contains a standalone command-line tool (CLI) for reading, creating, updating, and reporting tasks & projects against the [Huly](https://huly.io) project management framework using their official [`@hcengineering/api-client`](https://github.com/hcengineering/huly.core/tree/main/packages/api-client).

---

## 🙋‍♂️ For Human Readers

This section explains how you, as a developer or user, can securely set up and test the tool locally.

### Prerequisites
- Node.js 20+
- The following environment variables (via `~/.openclaw/.env` or your shell):
  - `HULY_API_KEY`
  - `HULY_HOST`
  - `HULY_WORKSPACE_ID`
- `pnpm` package manager.

### Setup & Compilation
Clone the repository and build the TypeScript definitions. Finally, link the executable globally so your AI Agents can find it:

```bash
git clone https://github.com/fioenix/huly-skill.git
cd huly-skill

pnpm install
pnpm run build
pnpm link --global
```

### Manual Verification (CLI Usage)
The `huly` command provides the main interface utilizing the Commander library. It formats output entirely in Vietnamese mapped with corresponding priority attributes and formatted dates.

To test that everything is working, ensure your environment variable is loaded and run:

```bash
# Load env vars (HULY_HOST, HULY_WORKSPACE_ID, HULY_API_KEY)
export $(grep -v '^#' ~/.openclaw/.env | xargs)

# List available projects
huly projects

# List all tasks for the current user
huly tasks --assignee me
```

*For more commands, see [AGENTS.md](./AGENTS.md).*

### Technical Details & Polyfills
The underlying `@hcengineering/api-client` presumes executions against browser DOM models `indexedDB`, and `window`. This project mitigates the library crashes via standard `fake-indexeddb` polyfills injected heavily within `src/index.ts`. No further setup or external browsers are necessary. 

API documentation references:
- **Core Platform:** [Huly Core Repository](https://github.com/hcengineering/huly.core)
- **API Client Syntax:** [Huly API-Client Readme](https://github.com/hcengineering/huly.core/tree/main/packages/api-client)

---

## 🤖 For Agent Readers

Moved to: [AGENTS.md](./AGENTS.md)
