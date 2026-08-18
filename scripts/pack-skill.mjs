#!/usr/bin/env node
/**
 * Rebuilds huly-skill.zip — the bundle uploaded to claude.ai as a Skill.
 *
 * It is committed, and it had gone three releases stale: the copy in the repo
 * carried the pre-1.7 SKILL.md and none of `references/`, so anyone uploading it
 * got documentation for a version that no longer existed. Nothing regenerated
 * it because nothing was responsible for it. Now `pnpm verify:release` fails
 * when it drifts.
 *
 *   node scripts/pack-skill.mjs            # rebuild the zip
 *   node scripts/pack-skill.mjs --check    # is the committed zip current?
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const zipPath = join(root, 'huly-skill.zip');
const check = process.argv.includes('--check');

/** What the zip must contain, as `path inside the zip` → `path in the repo`. */
const CONTENTS = {
    'huly-skill/SKILL.md': 'skills/huly-skill/SKILL.md',
    'huly-skill/references/setup.md': 'skills/huly-skill/references/setup.md',
    'huly-skill/references/commands.md': 'skills/huly-skill/references/commands.md',
    'huly-skill/references/recipes.md': 'skills/huly-skill/references/recipes.md',
    'huly-skill/bin/huly.cjs': 'bin/huly.cjs',
    'huly-skill/bin/bundle.cjs': 'bin/bundle.cjs',
};

if (check) {
    const stale = Object.entries(CONTENTS).filter(([inZip, inRepo]) => {
        let packed;
        try {
            packed = execFileSync('unzip', ['-p', zipPath, inZip], { maxBuffer: 1 << 26 });
        } catch {
            return true; // absent from the zip
        }
        return !packed.equals(readFileSync(join(root, inRepo)));
    });
    if (stale.length) {
        console.error(`huly-skill.zip is stale — run 'pnpm pack:skill' and commit it:`);
        for (const [inZip] of stale) console.error(`  ${inZip}`);
        process.exit(1);
    }
    console.log(`  ok    huly-skill.zip matches ${Object.keys(CONTENTS).length} source files`);
    process.exit(0);
}

const staging = mkdtempSync(join(tmpdir(), 'huly-skill-'));
try {
    for (const [inZip, inRepo] of Object.entries(CONTENTS)) {
        cpSync(join(root, inRepo), join(staging, inZip), { recursive: false, force: true, dereference: true, errorOnExist: false, mkdir: true });
    }
    rmSync(zipPath, { force: true });
    // -X drops extended attributes, so an unchanged skill produces an unchanged zip.
    execFileSync('zip', ['-rqX', zipPath, 'huly-skill'], { cwd: staging });
    console.log(`Wrote ${zipPath}`);
} finally {
    rmSync(staging, { recursive: true, force: true });
}
