import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor, hulyError } from '../utils/errors.js';
import { filterTeams, type TeamPerson } from '../utils/teams.js';

const label = (p: TeamPerson) => `${p.name || p._id}${p.active === false ? ' [inactive]' : ''}`;

export function teamsCommand() {
    return new Command('teams')
        .arguments('[name]')
        .description('List teams: HR departments with their members, and project membership. Pass a name to show one team.')
        .option('--projects', 'Also list members of every project (always on when a name is given)')
        .action(async (name, options) => {
            try {
                await withClient(async (client) => {
                    const all = await client.getTeams();
                    const teams = filterTeams(all, name);
                    if (name && teams.departments.length === 0 && teams.projects.length === 0) {
                        throw hulyError('not_found', `No department or project named "${name}"`);
                    }
                    const showProjects = Boolean(name) || Boolean(options.projects);
                    if (isJsonMode()) {
                        outputJson({ status: 'ok', departments: teams.departments, ...(showProjects ? { projects: teams.projects } : {}) });
                        return;
                    }
                    let out = '';
                    out += `DEPARTMENTS (${teams.departments.length})\n` + '='.repeat(50) + '\n';
                    for (const d of teams.departments) {
                        out += `  ${d.name} — ${d.members.length} member(s)\n`;
                        if (d.teamLead) out += `    Lead: ${label(d.teamLead)}\n`;
                        if (d.managers.length) out += `    Managers: ${d.managers.map(label).join(', ')}\n`;
                        for (const m of d.members) out += `    - ${label(m)}\n`;
                    }
                    if (showProjects) {
                        out += `\nPROJECTS (${teams.projects.length})\n` + '='.repeat(50) + '\n';
                        for (const p of teams.projects) {
                            out += `  ${p.identifier} (${p.name}) — ${p.members.length} member(s)\n`;
                            if (p.owners.length) out += `    Owners: ${p.owners.map(label).join(', ')}\n`;
                            for (const m of p.members) out += `    - ${label(m)}\n`;
                        }
                    }
                    printToConsole(out);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not load teams: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
