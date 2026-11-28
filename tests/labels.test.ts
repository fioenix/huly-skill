import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duplicateRefs, labelDisplay, parseColor, planAssign, planLabelRepair, planRepairTargets } from '../src/utils/labels.js';

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

test('an already-assigned label still has its duplicates removed, so a retry after a failed cleanup converges', () => {
    const refs = [
        { _id: 'ref-old', tag: 'tag-1', createdOn: 1 },
        { _id: 'ref-new', tag: 'tag-1', createdOn: 2 },
    ];
    const plan = planAssign(refs, 'tag-1', null);
    assert.equal(plan.alreadyAssigned, true);
    assert.deepEqual(plan.remove, ['ref-new']);
    assert.equal(plan.survivor?._id, 'ref-old', 'the reference that stays is the one to report');
});

test('a fresh insert that lost the race reports alreadyAssigned and removes itself', () => {
    const refs = [
        { _id: 'ref-other', tag: 'tag-1', createdOn: 1 },
        { _id: 'ref-mine', tag: 'tag-1', createdOn: 2 },
    ];
    assert.deepEqual(planAssign(refs, 'tag-1', 'ref-mine'), { alreadyAssigned: true, remove: ['ref-mine'], survivor: refs[0] });
    assert.deepEqual(planAssign([{ _id: 'ref-mine', tag: 'tag-1', createdOn: 2 }], 'tag-1', 'ref-mine'), { alreadyAssigned: false, remove: [], survivor: { _id: 'ref-mine', tag: 'tag-1', createdOn: 2 } });
});

test('repair resolves every task before writing, and reports the ones that do not exist', () => {
    const t1 = { _id: 'i1' };
    assert.deepEqual(planRepairTargets(['A-1', 'A-2', 'A-3'], [t1, null, null]), { targets: [{ taskId: 'A-1', task: t1 }], missing: ['A-2', 'A-3'] });
    assert.deepEqual(planRepairTargets(['A-1'], [t1]), { targets: [{ taskId: 'A-1', task: t1 }], missing: [] });
    assert.deepEqual(planRepairTargets(['A-1', 'A-1'], [t1, t1]).targets.length, 1, 'a repeated id is repaired once');
});

test('a color must be an integer from 0 to 15, so a typo cannot write NaN into Huly', () => {
    assert.equal(parseColor(undefined), undefined);
    assert.equal(parseColor('0'), 0);
    assert.equal(parseColor('15'), 15);
    for (const bad of ['red', '-1', '16', '1.5', '', ' 3']) assert.throws(() => parseColor(bad), /0 to 15/, bad);
});

test('labelDisplay never passes a non-finite color through', () => {
    assert.equal(labelDisplay(dso, undefined, Number.NaN).color, 1);
});
