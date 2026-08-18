# Releasing

The CLI and `@fioenix/huly-mcp` ship together under one version number.

## Version numbering

A release that adds a command, adds an MCP tool, or changes what a tool accepts
gets a **minor** bump. Patch is for fixes that change no interface. Every
release so far has added surface, hence 1.3.0 → 1.5.0 → 1.6.0 rather than patch
numbers.

## Checklist

Each step is a place a release has actually been left half-finished before.
Steps 1–3 and 6 are checked by `pnpm verify:release`, which CI also runs; the
rest still need a human.

1. **Bump the version in three places:**
   - `package.json` — `huly --version` and the MCP `initialize` handshake both
     derive from this one. esbuild substitutes it via `--define:__HULY_VERSION__`
     (see `src/version.ts`), so neither can drift from the manifest.
   - `npm-package/package.json` — the published package's own manifest
   - `skills/huly-skill/SKILL.md` frontmatter

   Two hardcoded constants used to carry the version instead, and both went
   stale unnoticed: the MCP handshake reported `1.2.0` through three releases,
   and `huly --version` reported `1.6.0` during the 1.6.1 release. Still verify
   by asking the binaries rather than grepping — `node bin/bundle.cjs --version`
   and the `initialize` handshake are what clients actually see.
2. **Write the `CHANGELOG.md` entry.** Give any behaviour that can break an
   existing caller its own heading saying so, e.g. `### Changed — may reject
   calls that previously succeeded`.
3. **Verify and rebuild.** `pnpm build` regenerates `bin/bundle.cjs` and `bin/mcp.cjs`, and
   copies the latter to `npm-package/huly-mcp.cjs`. The bundles are committed —
   local MCP clients run `bin/mcp.cjs` from a checkout, not from npm, so a
   forgotten rebuild ships stale code to every local client. Then:
   ```bash
   pnpm pack:skill      # huly-skill.zip, uploaded to claude.ai as a Skill
   pnpm verify:release --packed
   ```
   It asks the binaries what version they report rather than grepping for it,
   compares the published bundle against `bin/mcp.cjs` — including inside the
   tarball `npm publish` would upload — and fails if anything but JSON-RPC
   reaches stdout. Run the smoke test too, if the release touches a write path:
   ```bash
   HULY_SMOKE=1 pnpm smoke
   ```
4. **Open a PR and squash-merge it.** Branch from `main`, not from another
   feature branch — a squash merge of a branch stacked on an open PR swallows
   that PR's commits and leaves it open forever.
5. **Return to `main` and pull.**
6. **Verify the on-disk bundle matches `main`** before anyone restarts a client:
   ```bash
   git show main:bin/mcp.cjs | shasum -a 256
   shasum -a 256 bin/mcp.cjs
   ```
7. **Tag and push:**
   ```bash
   git tag -a v1.6.0 -m "v1.6.0 — short summary"
   git push origin v1.6.0
   ```
8. **Create the GitHub Release.** Pushing a tag does *not* create one — a
   release is a separate GitHub object, and 1.5.0 and 1.6.0 were both missing it
   until someone noticed:
   ```bash
   gh release create v1.6.0 --title "v1.6.0 — short summary" \
     --notes-file <changelog-section> --latest
   ```
9. **Publish to npm, from the tagged commit.** `npm publish` uploads whatever is
   in the working tree, and it has no idea a tag exists. Any commit that landed
   on `main` after the tag — including one that changes no behaviour — makes the
   published bundle differ from the tag while both still report the same
   version, which is exactly what happened in 1.6.1. Check first, and publish
   from a detached checkout if `main` has moved on:
   ```bash
   git rev-parse HEAD v1.6.1^{}     # must match; otherwise:
   git checkout v1.6.1              # then rebuild before publishing
   npm publish --access public ./npm-package
   git checkout main
   ```
   A version can only be published once, so a mismatch cannot be corrected
   without burning a patch number.
10. **Restart local MCP clients.** They spawn `bin/mcp.cjs` once at startup and
    hold it, so a running client keeps the old code until restarted.

## Verifying a published release

```bash
npm view @fioenix/huly-mcp version
gh release list --limit 3
```

To confirm npm shipped what was tagged, unpack the tarball and compare
`huly-mcp.cjs` against `bin/mcp.cjs` at the tag:

```bash
npm pack @fioenix/huly-mcp@1.6.1 && tar xzf fioenix-huly-mcp-1.6.1.tgz
shasum -a 256 package/huly-mcp.cjs
git show v1.6.1:bin/mcp.cjs | shasum -a 256
```

Then run the unpacked bundle rather than trusting the hash alone — the
handshake version is the one check that catches a build-time substitution that
did not happen:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | node package/huly-mcp.cjs
```

Its stdout must be JSON-RPC and nothing else; any other line is the Huly
client's log escaping onto the protocol channel.
