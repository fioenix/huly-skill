#!/usr/bin/env node
/**
 * Fails only for advisories that reach a shipped bundle.
 *
 * `pnpm audit` reports every advisory in the dependency graph, and most of this
 * project's graph never gets executed by a user: `@hcengineering/activity` and
 * `chunter` drag in svelte and dompurify for their Svelte components, which
 * esbuild never pulls into `bin/`. Treating those as failures means either a
 * permanently red gate or a habit of ignoring it — both worse than no gate.
 *
 * So this asks a narrower, answerable question: is a vulnerable package actually
 * inside `bin/mcp.cjs` or `bin/bundle.cjs`? esbuild's metafile lists every input
 * that made it in, which is the authority — not the lockfile, and not the
 * `dependencies` block.
 *
 * A failure here has one fix: add the patched range to `overrides` in
 * pnpm-workspace.yaml, cap it inside the major upstream depends on, and verify
 * the code path it belongs to. See reference/security-audit-2026-08.md.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const staging = mkdtempSync(join(tmpdir(), 'huly-audit-'));

const ENTRYPOINTS = { 'bin/mcp.cjs': 'src/mcp/index.ts', 'bin/bundle.cjs': 'src/index.ts' };

/** Package names esbuild actually pulled into each bundle. */
function bundledPackages() {
    const shipped = new Map();
    for (const [bundle, entry] of Object.entries(ENTRYPOINTS)) {
        const metafile = join(staging, `${bundle.replace('/', '-')}.json`);
        execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--platform=node',
            '--outfile=/dev/null', '--define:import.meta.url="file:///bundle"',
            '--define:__HULY_VERSION__="audit"', `--metafile=${metafile}`],
            { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
        for (const input of Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs)) {
            const name = packageNameOf(input);
            if (name) (shipped.get(name) ?? shipped.set(name, new Set()).get(name)).add(bundle);
        }
    }
    return shipped;
}

/** `…/node_modules/.pnpm/ws@8.21.3/node_modules/ws/lib/x.js` → `ws` */
function packageNameOf(path) {
    const parts = path.split('node_modules/');
    const tail = parts.at(-1);
    if (!tail || parts.length < 2) return null;
    const segments = tail.split('/');
    return segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
}

function advisories() {
    let stdout;
    try {
        stdout = execFileSync('pnpm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    } catch (e) {
        stdout = e.stdout; // pnpm audit exits nonzero whenever it finds anything
    }
    return Object.values(JSON.parse(stdout).advisories ?? {});
}

try {
    const shipped = bundledPackages();
    const found = advisories();
    const reaching = found.filter((a) => shipped.has(a.module_name));

    console.log(`${found.length} advisories in the dependency graph; ${shipped.size} packages reach a bundle`);

    for (const a of reaching) {
        console.log(`  ${a.severity.toUpperCase()} ${a.module_name} ${a.vulnerable_versions} — needs ${a.patched_versions}`);
        console.log(`    in ${[...shipped.get(a.module_name)].join(', ')} — ${a.title}`);
    }

    if (reaching.length) {
        console.log(`\n${reaching.length} advisory/advisories reach a shipped bundle. Add the patched range to`);
        console.log('overrides in pnpm-workspace.yaml, capped inside the current major.');
        process.exit(1);
    }
    console.log('\nNo advisory reaches a shipped bundle. The rest stay in the graph — build-time only.');
} finally {
    rmSync(staging, { recursive: true, force: true });
}
