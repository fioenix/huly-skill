import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duplicateRefs, labelDisplay, planLabelRepair } from '../src/utils/labels.js';

const dso = { _id: 'tag-1', title: 'DSO - Security', color: 1 };
const obs = { _id: 'tag-2', title: 'DSO - Observability', color: 12 };

test('labelDisplay falls back to the label title and color, never the id', () => {
    assert.deepEqual(labelDisplay(dso), { title: 'DSO - Security', color: 1 });
    assert.deepEqual(labelDisplay(dso, 'Custom', 4), { title: 'Custom', color: 4 });
    assert.deepEqual(labelDisplay({ _id: 'x', title: 'No color' }), { title: 'No color', color: 11 });
});

test('repair rewrites a reference whose title is the label id', () => {
    const plan = planLabelRepair([{ _id: 'ref-1', tag: 'tag-1', title: 'tag-1', color: 11 }], [dso]);
    assert.deepEqual(plan.updates, [{ refId: 'ref-1', title: 'DSO - Security', color: 1 }]);
    assert.deepEqual(plan.removals, []);
});

test('repair removes a second reference to the same label', () => {
    const plan = planLabelRepair([
        { _id: 'ref-1', tag: 'tag-2', title: 'tag-2', color: 11 },
        { _id: 'ref-2', tag: 'tag-2', title: 'DSO - Observability', color: 12 },
    ], [obs]);
    assert.deepEqual(plan.removals, ['ref-2']);
    assert.deepEqual(plan.updates, [{ refId: 'ref-1', title: 'DSO - Observability', color: 12 }]);
});

test('repair leaves correct references and unknown labels alone', () => {
    const plan = planLabelRepair([
        { _id: 'ref-1', tag: 'tag-1', title: 'DSO - Security', color: 1 },
        { _id: 'ref-2', tag: 'gone', title: 'gone', color: 11 },
    ], [dso]);
    assert.deepEqual(plan, { updates: [], removals: [] });
});

test('duplicateRefs keeps the oldest reference, whatever order they arrive in', () => {
    const refs = [
        { _id: 'b', tag: 'L', createdOn: 2 },
        { _id: 'a', tag: 'L', createdOn: 1 },
        { _id: 'c', tag: 'L', createdOn: 2 },
        { _id: 'x', tag: 'OTHER', createdOn: 0 },
    ];
    assert.deepEqual(duplicateRefs(refs, 'L'), ['b', 'c']);
    assert.deepEqual(duplicateRefs([...refs].reverse(), 'L'), ['b', 'c']);
    assert.deepEqual(duplicateRefs(refs, 'OTHER'), []);
    assert.deepEqual(duplicateRefs([], 'L'), []);
});

test('repair drops the same duplicate the race guard would', () => {
    const plan = planLabelRepair(
        [{ _id: 'new', tag: 'L', title: 'Label', color: 1, createdOn: 5 }, { _id: 'old', tag: 'L', title: 'Label', color: 1, createdOn: 1 }],
        [{ _id: 'L', title: 'Label', color: 1 }],
    );
    assert.deepEqual(plan.removals, ['new']);
});
