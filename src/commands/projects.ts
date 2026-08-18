import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor } from '../utils/errors.js';

export function projectsCommand() {
    return new Command('projects')
        .description('List all available projects in the workspace')
        .action(async () => {
            try {
                await withClient(async (client) => {
                    const projects = await client.getProjects();

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', count: projects.length, data: projects });
                        return;
                    }

                    if (!projects || projects.length === 0) {
                        printToConsole('✅ No projects in this workspace.');
                        return;
                    }

                    projects.sort((a, b) => (a.identifier || '').localeCompare(b.identifier || ''));

                    let output = `📋 PROJECTS (${projects.length})\n`;
                    output += '━'.repeat(60) + '\n';

                    for (const p of projects) {
                        output += `📌 [${p.identifier || 'N/A'}] ${p.name || 'Untitled'}\n`;
                        output += `   🆔 ID: ${p._id}\n`;
                        output += `   📅 Updated: ${p.modifiedOn ? formatDate(p.modifiedOn) : 'N/A'}\n`;
                        output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    }

                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`❌ Could not load projects: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
