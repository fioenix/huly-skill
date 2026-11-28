import { test } from 'node:test';
import assert from 'node:assert/strict';

import { issueUrl } from '../src/utils/links.js';

// --- AC-3: a task carries its web link -------------------------------------

test('TC-3.1 issue link is host + /workbench/<workspace slug>/tracker/<identifier>', () => {
    assert.equal(
        issueUrl('https://huly.example.com', 'demo', 'DELTA-42'),
        'https://huly.example.com/workbench/demo/tracker/DELTA-42',
    );
});

test('TC-3.2 trailing slashes on the host are dropped', () => {
    assert.equal(
        issueUrl('https://huly.example.com//', 'demo', 'DELTA-42'),
        'https://huly.example.com/workbench/demo/tracker/DELTA-42',
    );
});

test('TC-3.3 a missing host, slug or identifier yields null rather than a broken link', () => {
    for (const [host, slug, id] of [
        [undefined, 'demo', 'DELTA-42'],
        ['', 'demo', 'DELTA-42'],
        ['https://huly.example.com', null, 'DELTA-42'],
        ['https://huly.example.com', '', 'DELTA-42'],
        ['https://huly.example.com', 'demo', undefined],
    ] as const) {
        assert.equal(issueUrl(host, slug, id), null);
    }
});

test('TC-3.4 slug and identifier are encoded as one path segment each', () => {
    assert.equal(
        issueUrl('https://huly.example.com', 'my ws/x', 'DELTA-42'),
        'https://huly.example.com/workbench/my%20ws%2Fx/tracker/DELTA-42',
    );
});
