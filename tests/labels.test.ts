import { test } from 'node:test';
import assert from 'node:assert/strict';

import { labelDisplay, planLabelRepair } from '../src/utils/labels.js';

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
