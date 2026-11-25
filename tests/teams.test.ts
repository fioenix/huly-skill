import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, filterTeams } from '../src/utils/teams.ts';

const STAFF = 'hr:mixin:Staff';
const EMP = 'contact:mixin:Employee';
const persons = [
    { _id: 'p1', name: 'Lý Đức,Huy', personUuid: 'u1', [EMP]: { active: true } },
    { _id: 'p2', name: 'Anh,Quốc', personUuid: 'u2', [EMP]: { active: true } },
    { _id: 'p3', name: 'Old,Member', personUuid: 'u3', [EMP]: { active: false } },
];
const input = {
    persons,
    departments: [{ _id: 'd1', name: 'Beta', managers: ['p2'], teamLead: 'p2' }, { _id: 'd2', name: 'Delta' }],
    staff: [{ _id: 'p2', [STAFF]: { department: 'd1' } }, { _id: 'p3', [STAFF]: { department: 'd1' } }, { _id: 'p1', [STAFF]: {} }],
    projects: [{ _id: 'x', identifier: 'INFRA', name: 'BETA', owners: ['u2'], members: ['u1', 'u2', 'u2', 'ghost'] }],
    staffMixin: STAFF, employeeMixin: EMP,
};

test('department members come from the Staff mixin', () => {
    const t = buildTeams(input);
    const beta = t.departments.find((d) => d.name === 'Beta')!;
    assert.deepEqual(beta.members.map((m) => m.name), ['Anh,Quốc', 'Old,Member']);
    assert.equal(beta.members.find((m) => m.name === 'Old,Member')!.active, false);
    assert.equal(beta.teamLead!.name, 'Anh,Quốc');
    assert.deepEqual(t.departments.find((d) => d.name === 'Delta')!.members, []);
});

test('project members resolve account UUIDs, are de-duplicated, and keep unknown refs', () => {
    const infra = buildTeams(input).projects[0];
    assert.deepEqual(infra.members.map((m) => m.name), ['', 'Anh,Quốc', 'Lý Đức,Huy']);
    assert.equal(infra.members[0]._id, 'ghost');
    assert.deepEqual(infra.owners.map((m) => m._id), ['p2']);
});

test('filter matches department name and project name or identifier, case-insensitively', () => {
    const t = buildTeams(input);
    const beta = filterTeams(t, 'beta');
    assert.equal(beta.departments.length, 1);
    assert.equal(beta.projects.length, 1);
    assert.equal(filterTeams(t, 'infra').projects.length, 1);
    assert.equal(filterTeams(t, 'nope').departments.length, 0);
    assert.equal(filterTeams(t).departments.length, 2);
});
