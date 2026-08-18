#!/usr/bin/env node
/**
 * Checks the release invariants that RELEASING.md asks a human to remember.
 *
 * Every check here corresponds to a release that actually went out wrong: the
 * MCP handshake reporting 1.2.0 for three releases, `huly --version` reporting
 * 1.6.0 during 1.6.1, and a published bundle differing from its tag. Grepping
 * for the version is not enough — these ask the binaries what they report, the
 * same way a client does.
 *
 *   node scripts/verify-release.mjs            # the working tree
 *   node scripts/verify-release.mjs --packed   # plus the tarball npm would upload
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

function check(label, actual, expected) {
    if (actual === expected) console.log(`  ok    ${label}: ${actual}`);
    else {
        console.log(`  FAIL  ${label}: ${actual} (expected ${expected})`);
        failures.push(label);
    }
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);
const read = (relative) => readFileSync(join(root, relative));
const json = (relative) => JSON.parse(read(relative).toString());

/** The version the MCP server announces in its initialize handshake. */
function handshake(bundlePath, cwd = root) {
    const request = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } },
    });
    const stdout = execFileSync(process.execPath, [bundlePath], { input: `${request}\n`, cwd, encoding: 'utf8' });
    const lines = stdout.trim().split('\n').filter(Boolean);
    // stdout carries the JSON-RPC framing; a stray log line here breaks clients
    // that parse it, which is why 1.6.1 moved the Huly client's log to stderr.
    const stray = lines.filter((line) => !line.startsWith('{'));
    if (stray.length) failures.push(`non-protocol output on stdout: ${stray[0].slice(0, 60)}`);
    return JSON.parse(lines.find((line) => line.startsWith('{')) ?? '{}').result?.serverInfo?.version;
}

const version = json('package.json').version;
console.log(`Verifying release ${version}\n`);

console.log('version agreement');
check('npm-package/package.json', json('npm-package/package.json').version, version);
const frontmatter = read('skills/huly-skill/SKILL.md').toString().match(/^\s*version:\s*"?([^"\n]+)"?/m);
check('SKILL.md frontmatter', frontmatter?.[1]?.trim(), version);

console.log('\nwhat the binaries report');
check('huly --version', execFileSync(process.execPath, [join(root, 'bin/bundle.cjs'), '--version'], { encoding: 'utf8' }).trim(), version);
check('MCP initialize handshake', handshake(join(root, 'bin/mcp.cjs')), version);

console.log('\nbundle identity');
check('npm-package/huly-mcp.cjs == bin/mcp.cjs', sha(read('npm-package/huly-mcp.cjs')), sha(read('bin/mcp.cjs')));

if (process.argv.includes('--packed')) {
    console.log('\nthe tarball npm would upload');
    const staging = mkdtempSync(join(tmpdir(), 'huly-pack-'));
    try {
        // --ignore-scripts: prepublishOnly rebuilds, which would hide a stale bundle.
        const packed = execFileSync('npm', ['pack', join(root, 'npm-package'), '--pack-destination', staging, '--ignore-scripts', '--silent'],
            { encoding: 'utf8' }).trim().split('\n').pop();
        execFileSync('tar', ['xzf', join(staging, packed)], { cwd: staging });
        const unpacked = join(staging, 'package');
        check('tarball huly-mcp.cjs', sha(readFileSync(join(unpacked, 'huly-mcp.cjs'))), sha(read('bin/mcp.cjs')));
        check('unpacked handshake', handshake(join(unpacked, 'huly-mcp.cjs'), unpacked), version);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
