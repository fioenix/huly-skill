import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRank } from '../src/huly-types.js';

// LexoRank as the Huly UI parses it: bucket digit, '|', base-36 payload, ':'.
const VALID = /^[0-2]\|[0-9a-z]+:?$/;

test('every rank stays inside the LexoRank alphabet the UI can parse', () => {
    let rank = makeRank(undefined, undefined);
    assert.match(rank, VALID);
    // 26 appends is what it used to take to walk the last character out of
    // base-36 and into 'T', the point where the UI stopped accepting the list.
    for (let i = 0; i < 200; i++) {
        rank = makeRank(rank, undefined);
        assert.match(rank, VALID, `rank ${rank} at iteration ${i}`);
    }
});

test('ranks keep increasing so new issues land at the end', () => {
    let prev = makeRank(undefined, undefined);
    for (let i = 0; i < 50; i++) {
        const next = makeRank(prev, undefined);
        assert.ok(next > prev, `${next} should sort after ${prev}`);
        prev = next;
    }
});

test('a rank between two others sorts between them', () => {
    const first = makeRank(undefined, undefined);
    const third = makeRank(makeRank(first, undefined), undefined);
    const middle = makeRank(first, third);
    assert.match(middle, VALID);
    assert.ok(middle > first && middle < third);
});

test('a rank corrupted by an earlier release does not block creation', () => {
    const rank = makeRank('0|i005efT', undefined);
    assert.match(rank, VALID);
});
