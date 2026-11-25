/**
 * Pure assembly of the `teams` view. Kept free of the Huly client so it can be
 * tested with plain objects.
 *
 * Huly refers to people in three ways that all show up here: a Person `_id`,
 * the account UUID stored as `personUuid` on that Person (used by project
 * `members`/`owners`), and Person docs carrying the HR Staff mixin (used for
 * department membership).
 */
export interface TeamPerson { _id: string; name: string; active: boolean | null; }
export interface Department {
    _id: string;
    name: string;
    parent: string | null;
    teamLead: TeamPerson | null;
    managers: TeamPerson[];
    members: TeamPerson[];
}
export interface ProjectTeam { _id: string; identifier: string; name: string; owners: TeamPerson[]; members: TeamPerson[]; }
export interface Teams { departments: Department[]; projects: ProjectTeam[]; }

export function buildTeams(input: {
    departments: any[]; staff: any[]; persons: any[]; projects: any[];
    staffMixin: string; employeeMixin: string;
}): Teams {
    const byRef = new Map<string, TeamPerson>();
    for (const p of input.persons) {
        const emp = p[input.employeeMixin];
        const person: TeamPerson = { _id: p._id, name: p.name || '', active: emp ? emp.active === true : null };
        byRef.set(p._id, person);
        if (p.personUuid) byRef.set(p.personUuid, person);
    }
    const resolve = (ref: string): TeamPerson => byRef.get(ref) ?? { _id: ref, name: '', active: null };
    const unique = (refs: string[] = []): TeamPerson[] => {
        const seen = new Map<string, TeamPerson>();
        for (const r of refs) { const p = resolve(r); seen.set(p._id, p); }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    };

    const membersOf = new Map<string, string[]>();
    for (const s of input.staff) {
        const dep = (s[input.staffMixin] ?? s).department;
        if (!dep) continue;
        membersOf.set(dep, [...(membersOf.get(dep) ?? []), s._id]);
    }

    return {
        departments: input.departments
            .map((d) => ({
                _id: d._id,
                name: d.name || '',
                parent: d.parent ?? null,
                teamLead: d.teamLead ? resolve(d.teamLead) : null,
                managers: unique(d.managers),
                members: unique(membersOf.get(d._id)),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        projects: input.projects
            .map((p) => ({ _id: p._id, identifier: p.identifier, name: p.name || '', owners: unique(p.owners), members: unique(p.members) }))
            .sort((a, b) => a.identifier.localeCompare(b.identifier)),
    };
}

/** Case-insensitive match on department name, project name or project identifier. */
export function filterTeams(teams: Teams, name?: string): Teams {
    if (!name) return teams;
    const n = name.trim().toLowerCase();
    return {
        departments: teams.departments.filter((d) => d.name.toLowerCase() === n),
        projects: teams.projects.filter((p) => p.name.toLowerCase() === n || p.identifier.toLowerCase() === n),
    };
}
