import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Docs for huly attach: only the tmp directory itself is refused as a working
// directory, and a connection error can say retryable: false.

const ROOT = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function attachLine(path: string, prefix: string): string {
    const line = read(path).split('\n').find((l) => l.startsWith(prefix));
    assert.ok(line, `${path} has a line starting with ${prefix}`);
    return line!;
}

/** The JSON Mode paragraph that starts "On failure", up to the blank line ending it. */
function jsonModeParagraph(): string {
    const agents = read('AGENTS.md');
    const start = agents.indexOf('On failure, `code` is one of');
    assert.ok(start >= 0);
    return agents.slice(start, agents.indexOf('\n\n', start));
}

test('TC-1.1 the huly attach row of AGENTS.md names the tmp directory itself', () => {
    assert.match(attachLine('AGENTS.md', '| `huly attach'), /tmp directory itself/);
});

test('TC-1.2 the huly attach note of SKILL.md names the tmp directory itself', () => {
    const skill = read('skills/huly-skill/SKILL.md');
    const start = skill.indexOf('- `huly attach` reads only');
    assert.ok(start >= 0);
    assert.match(skill.slice(start, skill.indexOf('\n- ', start + 1)), /tmp directory itself/);
});

test('TC-1.3 neither file still says just "or tmp)"', () => {
    for (const path of ['AGENTS.md', 'skills/huly-skill/SKILL.md']) {
        assert.doesNotMatch(read(path), /or tmp\)/, path);
    }
});

test('TC-2.1 JSON Mode names the retryable: false exception of huly attach', () => {
    const paragraph = jsonModeParagraph();
    assert.match(paragraph, /retryable: false/);
    assert.match(paragraph, /huly attach/);
});

test('TC-2.2 JSON Mode still says only connection is retryable', () => {
    assert.match(jsonModeParagraph(), /only `connection` is `retryable`/);
});
