import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, planMove } from '../src/utils/move.ts';

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
        ['update', 'p', 'a', { attachedTo: 'o', rank: '0|i0000a:' }],
        ['update', 'p', 'r', { $inc: { subIssues: -1 } }],
        ['update', 'p', 'o', { $inc: { subIssues: 1 } }],
        ['commit'],
    ]);
});

test('detaching only decrements the old parent; attaching a root only increments the new one', async () => {
    const detach = recordingOps();
    await applyMove(detach.ops, { issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r' }, attachedTo: NO_PARENT, oldParentId: 'r', newParent: null });
    assert.deepEqual(detach.calls.filter((c) => c[0] === 'update').map((c) => c[3]), [{ attachedTo: NO_PARENT }, { $inc: { subIssues: -1 } }]);
    const attach = recordingOps();
    await applyMove(attach.ops, { issueClass: 'Issue', task: { _id: 'o', identifier: 'X-4', space: 'p', attachedTo: NO_PARENT }, attachedTo: 'r', rank: 'x', oldParentId: null, newParent: { _id: 'r', space: 'p' } });
    assert.deepEqual(attach.calls.filter((c) => c[0] === 'update').map((c) => c[3]), [{ attachedTo: 'r', rank: 'x' }, { $inc: { subIssues: 1 } }]);
});

test('a refused commit (the task moved meanwhile) is an error, not a silent success', async () => {
    const { ops } = recordingOps(false);
    await assert.rejects(
        applyMove(ops, { issueClass: 'Issue', task: { _id: 'a', identifier: 'X-2', space: 'p', attachedTo: 'r' }, attachedTo: 'o', oldParentId: 'r', newParent: { _id: 'o', space: 'p' } }),
        /changed while it was being moved, so nothing was written/,
    );
});
