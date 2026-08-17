/**
 * The released version, injected at build time.
 *
 * esbuild replaces `__HULY_VERSION__` with package.json's `version` (see the
 * `--define` flags in the build scripts), so the shipped bundles cannot drift
 * from the manifest. Two hardcoded constants used to carry this instead and
 * both went stale unnoticed: the MCP handshake reported 1.2.0 through three
 * releases, and `huly --version` reported 1.6.0 during the 1.6.1 release.
 *
 * `index.ts` also used to read package.json at runtime, but esbuild rewrites
 * `import.meta.url` to `file:///bundle`, so that read always threw in the
 * shipped bundle and only the fallback constant was ever seen.
 *
 * Running the TypeScript directly (tsx) applies no define, hence the guard.
 */
declare const __HULY_VERSION__: string;

export const VERSION: string =
    typeof __HULY_VERSION__ === 'string' ? __HULY_VERSION__ : '0.0.0-dev';
