<!-- What changes, and why. Link an issue if there is one. -->

## Checks

- [ ] `pnpm typecheck && pnpm test && pnpm build && pnpm verify:release` pass
- [ ] `bin/` is committed if the build changed it (CI fails on a dirty tree)
- [ ] `CHANGELOG.md` updated; anything that can reject a previously working call
      has its own heading saying so
- [ ] `HULY_SMOKE=1 pnpm smoke` run, if a write path changed
