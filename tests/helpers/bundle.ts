import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Bundle the real CJS-interoperating Huly imports without starting the CLI,
// loading credential files, opening listeners, or connecting to Huly.
export function bundleSource(entry: string) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const staging = mkdtempSync(join(tmpdir(), 'huly-test-'));
    const output = join(staging, 'module.cjs');
    try {
        buildSync({
            absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node',
            target: 'node20', format: 'cjs', outfile: output, logLevel: 'silent',
            nodePaths: [join(root, 'node_modules/.pnpm/node_modules')],
            define: { 'import.meta.url': '"file:///bundle"', __HULY_VERSION__: '"test"' },
        });
        return createRequire(import.meta.url)(output);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}
