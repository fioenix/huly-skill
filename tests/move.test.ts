import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, currentParentId, isTopLevel, planMove } from '../src/utils/move.js';

const NO_PARENT = 'tracker:ids:NoParent';
const root = { _id: 'r', identifier: 'X-1', space: 'p', parents: [] };
const a = { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r', parents: [{ parentId: 'r' }] };
const b = { _id: 'b', identifier: 'X-3', space: 'p', attachedTo: 'a', parents: [{ parentId: 'a' }, { parentId: 'r' }] };
const other = { _id: 'o', identifier: 'X-4', space: 'p', parents: [] };

test('moves under a new parent in the same project', () => {
    assert.deepEqual(planMove(a, other, NO_PARENT), { action: 'move', attachedTo: 'o' });
});

test('detaching sets the NoParent sentinel', () => {
    assert.deepEqual(planMove(a, null, NO_PARENT), { action: 'move', attachedTo: NO_PARENT });
});

test('already under the parent is a no-op', () => {
    assert.equal(planMove(a, root, NO_PARENT).action, 'noop');
    assert.equal(planMove(root, null, NO_PARENT).action, 'noop');
});

test('rejects self, descendants and other projects', () => {
    assert.throws(() => planMove(a, a, NO_PARENT), /own parent/);
    assert.throws(() => planMove(a, b, NO_PARENT), /cycle/);
    assert.throws(() => planMove(a, { ...other, space: 'q' }, NO_PARENT), /another project/);
});

function recordingOps(result = true) {
    const calls: any[] = [];
    const ops = {
        match(_class: unknown, query: any) { calls.push(['match', query]); return ops; },
        async updateDoc(_class: unknown, space: string, id: string, update: any) { calls.push(['update', space, id, update]); },
        async commit() { calls.push(['commit']); return { result }; },
    };
    return { ops, calls };
}

test('a move is one transaction that adjusts both counters by $inc', async () => {
    const { ops, calls } = recordingOps();
    await applyMove(ops, {
        issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r' },
        attachedTo: 'o', rank: '0|i0000a:', oldParentId: 'r', newParent: { _id: 'o', space: 'p' },
    });
    assert.deepEqual(calls, [
        ['match', { _id: 'a', attachedTo: 'r' }],
        ['match', { _id: 'o', space: 'p', attachedTo: null }],
        ['update', 'p', 'a', { attachedTo: 'o', attachedToClass: 'Issue', collection: 'subIssues', rank: '0|i0000a:' }],
        ['update', 'p', 'r', { $inc: { subIssues: -1 } }],
        ['update', 'p', 'o', { $inc: { subIssues: 1 } }],
        ['commit'],
    ]);
});

test('detaching only decrements the old parent; attaching a root only increments the new one', async () => {
    const detach = recordingOps();
    await applyMove(detach.ops, { issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r' }, attachedTo: NO_PARENT, oldParentId: 'r', newParent: null });
    assert.deepEqual(detach.calls.filter((c) => c[0] === 'update').map((c) => c[3]), [{ attachedTo: NO_PARENT, attachedToClass: 'Issue', collection: 'subIssues' }, { $inc: { subIssues: -1 } }]);
    const attach = recordingOps();
    await applyMove(attach.ops, { issueClass: 'Issue', task: { _id: 'o', identifier: 'X-4', space: 'p', attachedTo: NO_PARENT }, attachedTo: 'r', rank: 'x', oldParentId: null, newParent: { _id: 'r', space: 'p' } });
    assert.deepEqual(attach.calls.filter((c) => c[0] === 'update').map((c) => c[3]), [{ attachedTo: 'r', attachedToClass: 'Issue', collection: 'subIssues', rank: 'x' }, { $inc: { subIssues: 1 } }]);
});

test('a refused commit (the task moved meanwhile) is an error, not a silent success', async () => {
    const { ops } = recordingOps(false);
    await assert.rejects(
        applyMove(ops, { issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r' }, attachedTo: 'o', oldParentId: 'r', newParent: { _id: 'o', space: 'p' } }),
        /changed while it was being moved, so nothing was written/,
    );
});

test('a task created top-level by the CLI becomes a real sub-issue when moved', async () => {
    // `huly create task` without --parent writes attachedTo=<project>, collection 'issues'.
    const { ops, calls } = recordingOps();
    await applyMove(ops, {
        issueClass: 'Issue', task: { _id: 't', identifier: 'X-9', space: 'p', attachedTo: 'p' },
        attachedTo: 'r', rank: 'x', oldParentId: null, newParent: { _id: 'r', space: 'p' },
    });
    const update = calls.find((c) => c[0] === 'update' && c[2] === 't')[3];
    assert.equal(update.collection, 'subIssues', 'sub-issue queries filter on collection');
    assert.equal(update.attachedToClass, 'Issue');
});

test('the commit is conditional on the new parent staying where it was read, and on a missing attachedTo too', async () => {
    const { ops, calls } = recordingOps();
    await applyMove(ops, {
        issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p' },
        attachedTo: 'o', oldParentId: null, newParent: { _id: 'o', space: 'p', attachedTo: 'q' },
    });
    assert.deepEqual(calls.filter((c) => c[0] === 'match').map((c) => c[1]), [
        { _id: 'a', attachedTo: null },
        { _id: 'o', space: 'p', attachedTo: 'q' },
    ]);
});

test('the current parent falls back to attachedTo when parents is empty, but not to the project or NoParent', () => {
    assert.equal(currentParentId({ _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r', parents: [] }, NO_PARENT), 'r');
    assert.equal(currentParentId({ _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'p', parents: [] }, NO_PARENT), null);
    assert.equal(currentParentId({ _id: 'a', identifier: 'X-2', space: 'p', attachedTo: NO_PARENT }, NO_PARENT), null);
    assert.equal(currentParentId(b, NO_PARENT), 'a');
    // A drifted doc (attachedTo set, parents empty) can still be detached.
    assert.equal(planMove({ _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r', parents: [] }, null, NO_PARENT).action, 'move');
});

test('top-level means attached to the project (huly create task) or to NoParent (the Huly UI, or a detached task)', () => {
    assert.equal(isTopLevel({ space: 'p', attachedTo: 'p' }, NO_PARENT), true);
    assert.equal(isTopLevel({ space: 'p', attachedTo: NO_PARENT }, NO_PARENT), true);
    assert.equal(isTopLevel({ space: 'p', attachedTo: 'r' }, NO_PARENT), false);
});
