import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor } from '../utils/errors.js';
import { resolveProject } from '../resolvers.js';

export function kindsCommand() {
    return new Command('kinds')
        .description('List task types (kinds) available in a project')
        .requiredOption('-p, --project <project>', 'Project identifier (e.g., OMEGA)')
        .action(async (options) => {
            try {
                await withClient(async (client) => {
                    const project = await resolveProject(client, options.project);
                    const kinds = await client.getTaskKinds(project._id);

                    if (isJsonMode()) {
                        outputJson({
                            status: 'ok',
                            project: project.identifier,
                            count: kinds.length,
                            data: kinds.map((k: any) => ({ _id: k._id, name: k.name, kind: k.kind })),
                        });
                        return;
                    }

                    if (kinds.length === 0) {
                        printToConsole(`Project ${project.identifier} has no task types.`);
                        return;
                    }

                    let output = `TASK KINDS - ${project.identifier} (${kinds.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const k of kinds) {
                        output += `  ${k.name} [${k.kind}]\n`;
                        output += `    ID: ${k._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not load task kinds: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
