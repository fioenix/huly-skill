import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMove } from '../src/utils/move.ts';

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
