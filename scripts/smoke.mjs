#!/usr/bin/env node
/**
 * End-to-end smoke test against a real Huly workspace: create → read → comment →
 * delete one issue, through the built CLI binary rather than the source.
 *
 * Opt-in, and deliberately not in CI: it needs credentials and it writes to a
 * live workspace. Run it by hand before a release. The unit tests cover shaping,
 * classification and credential precedence — pure functions with no server; this
 * covers the half they cannot see, where a Huly SDK change or a bundling mistake
 * breaks a call that still typechecks.
 *
 *   HULY_SMOKE=1 pnpm smoke                       # first project in the workspace
 *   HULY_SMOKE=1 HULY_SMOKE_PROJECT=DELTA pnpm smoke
 *
 * The issue it creates is deleted at the end, including when a step fails.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

if (process.env.HULY_SMOKE !== '1') {
    console.error('Refusing to run: this writes to a real workspace. Set HULY_SMOKE=1 to confirm.');
    process.exit(2);
}

const cli = join(fileURLToPath(new URL('..', import.meta.url)), 'bin/bundle.cjs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const title = `huly-skill smoke ${stamp}`;
let created;

/** Run the CLI in JSON mode and return the parsed envelope, failures included. */
function huly(...args) {
    const label = `huly ${args.join(' ')}`;
    let stdout;
    try {
        stdout = execFileSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8' });
    } catch (e) {
        stdout = e.stdout || '';
        if (!stdout.trim()) throw new Error(`${label}: no output (${e.message})`);
    }
    try {
        return { label, ...JSON.parse(stdout) };
    } catch {
        throw new Error(`${label}: stdout is not JSON — ${stdout.slice(0, 200)}`);
    }
}

function step(description, fn) {
    process.stdout.write(`  ${description} … `);
    const detail = fn();
    console.log(detail ?? 'ok');
}

function expectOk(envelope) {
    if (envelope.status !== 'ok') throw new Error(`${envelope.label}: ${envelope.error} [${envelope.code}]`);
    return envelope;
}

console.log(`Smoke test against ${process.env.HULY_HOST} / ${process.env.HULY_WORKSPACE_ID}\n`);
try {
    step('whoami', () => expectOk(huly('whoami')).data?.host ?? 'connected');

    const project = process.env.HULY_SMOKE_PROJECT
        ?? expectOk(huly('projects')).data?.[0]?.identifier;
    if (!project) throw new Error('no project to write to — set HULY_SMOKE_PROJECT');

    step(`create in ${project}`, () => {
        created = expectOk(huly('create', 'task', title, '--project', project, '--priority', 'LOW')).data?.identifier;
        if (!created) throw new Error('create returned status ok with no identifier');
        return created;
    });

    step('read back', () => {
        const task = expectOk(huly('task', created)).data;
        if (task?.title !== title) throw new Error(`title came back as ${JSON.stringify(task?.title)}`);
    });

    step('appears in a listing', () => {
        const rows = expectOk(huly('tasks', '--project', project, '--limit', '0')).data ?? [];
        if (!rows.some((row) => row.identifier === created)) throw new Error('created issue missing from its project listing');
        // Projection is the default on MCP but opt-in on the CLI; both must keep _id.
        if (!rows[0]._id) throw new Error('listing rows lost _id');
    });

    step('comment', () => {
        expectOk(huly('update', 'task', created, '--add-comment', 'smoke test'));
        const comments = expectOk(huly('activity', created, '--comments-only')).data ?? [];
        if (!comments.some((entry) => JSON.stringify(entry).includes('smoke test'))) throw new Error('comment did not come back');
    });

    let gone;
    step('delete', () => {
        gone = created;
        expectOk(huly('delete', 'task', created, '--yes'));
        created = undefined;
    });

    step('a deleted issue reports not_found, not a bare failure', () => {
        const result = huly('task', gone);
        if (result.status !== 'error') throw new Error('deleted issue still resolves');
        if (result.code !== 'not_found') throw new Error(`classified as ${result.code}, expected not_found`);
        if (result.retryable) throw new Error('not_found must not be retryable');
    });

    console.log('\nAll steps passed');
} catch (e) {
    console.log('FAILED');
    console.error(`\n${e.message}`);
    if (created) {
        console.error(`\nCleaning up ${created} …`);
        try {
            huly('delete', 'task', created, '--yes');
        } catch {
            console.error(`Could not delete ${created} — remove it by hand.`);
        }
    }
    process.exit(1);
}
