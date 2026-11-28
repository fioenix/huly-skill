import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LIST_LIMIT, LIST_FIELDS, parseFields, projectRows, shapeList } from '../src/utils/projection.js';

const rows = Array.from({ length: 120 }, (_, i) => ({
    _id: `id-${i}`,
    identifier: `DELTA-${i}`,
    title: `Task ${i}`,
    rank: 'zzz|aaa',
    childInfo: [{ childId: 'x' }],
    docUpdateMessages: 42,
}));

test('caps at the default limit and says it truncated', () => {
    const result = shapeList(rows, 'task');
    assert.equal(result.rows.length, DEFAULT_LIST_LIMIT);
    assert.equal(result.total, 120);
    assert.equal(result.truncated, true);
});

test('does not claim truncation when everything fits', () => {
    const result = shapeList(rows.slice(0, 3), 'task');
    assert.equal(result.rows.length, 3);
    assert.equal(result.truncated, false);
});

test('limit 0 means no cap', () => {
    const result = shapeList(rows, 'task', { limit: 0 });
    assert.equal(result.rows.length, 120);
    assert.equal(result.truncated, false);
});

test('drops storage bookkeeping fields by default', () => {
    const [row] = shapeList(rows, 'task').rows;
    assert.equal(row.identifier, 'DELTA-0');
    for (const noise of ['rank', 'childInfo', 'docUpdateMessages']) {
        assert.equal(noise in row, false, `${noise} should not survive projection`);
    }
});

test('_id survives projection — comment and label tools address objects by it', () => {
    for (const entity of Object.keys(LIST_FIELDS) as (keyof typeof LIST_FIELDS)[]) {
        assert.ok(LIST_FIELDS[entity].includes('_id'), `${entity} must keep _id`);
    }
});

test('fields "all" returns whole documents', () => {
    const [row] = shapeList(rows, 'task', { fields: 'all' }).rows;
    assert.equal(row.rank, 'zzz|aaa');
    assert.equal(Object.keys(row).length, Object.keys(rows[0]).length);
});

test('an explicit field list wins over the default', () => {
    const [row] = shapeList(rows, 'task', { fields: 'identifier,rank' }).rows;
    assert.deepEqual(Object.keys(row), ['identifier', 'rank']);
});

test('a field a document lacks is simply absent, not null', () => {
    const [row] = projectRows([{ a: 1 }], ['a', 'missing']);
    assert.deepEqual(row, { a: 1 });
});

test('empty or whitespace fields falls back to the default set', () => {
    assert.deepEqual(parseFields('   ', 'task'), null);
    assert.deepEqual(parseFields(undefined, 'user'), [...LIST_FIELDS.user]);
    assert.deepEqual(parseFields(',,', 'user'), [...LIST_FIELDS.user]);
});

test('milestone listings leave out the ProseMirror description blob', () => {
    assert.equal(LIST_FIELDS.milestone.includes('description'), false);
});

test('team listings return counts by default, so one large department cannot flood the result', () => {
    const people = Array.from({ length: 5000 }, (_, i) => ({ _id: `p${i}`, name: `Person ${i}`, active: true }));
    const department = { _id: 'd1', name: 'Everyone', teamLead: null, managers: [people[0]], memberCount: people.length, members: people };
    const project = { _id: 'pr1', identifier: 'ALL', name: 'All', owners: [people[0]], memberCount: people.length, members: people };
    for (const [entity, row] of [['team', department], ['projectTeam', project]] as const) {
        const shaped = shapeList([row], entity, { limit: 1 });
        assert.equal((shaped.rows[0] as any).memberCount, 5000);
        assert.equal('members' in (shaped.rows[0] as any), false, `${entity}: members only on request`);
        const expanded = shapeList([row], entity, { limit: 1, fields: 'all' });
        assert.equal((expanded.rows[0] as any).members.length, 5000);
    }
});
