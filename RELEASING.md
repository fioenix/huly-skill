# Releasing

The CLI and `@fioenix/huly-mcp` ship together under one version number.

## Version numbering

A release that adds a command, adds an MCP tool, or changes what a tool accepts
gets a **minor** bump. Patch is for fixes that change no interface. Every
release so far has added surface, hence 1.3.0 → 1.5.0 → 1.6.0 rather than patch
numbers.

## Checklist

Nothing here is automated — each step is a place a release has actually been
left half-finished before.

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
3. **Rebuild.** `pnpm build` regenerates `bin/bundle.cjs` and `bin/mcp.cjs`, and
   copies the latter to `npm-package/huly-mcp.cjs`. The bundles are committed —
   local MCP clients run `bin/mcp.cjs` from a checkout, not from npm, so a
   forgotten rebuild ships stale code to every local client.
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
9. **Publish to npm:**
   ```bash
   npm publish --access public ./npm-package
   ```
10. **Restart local MCP clients.** They spawn `bin/mcp.cjs` once at startup and
    hold it, so a running client keeps the old code until restarted.

## Verifying a published release

```bash
npm view @fioenix/huly-mcp version
gh release list --limit 3
```

To confirm npm shipped what was tagged, unpack the tarball and compare
`huly-mcp.cjs` against `bin/mcp.cjs` at the tag.
