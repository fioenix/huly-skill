import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor } from '../utils/errors.js';

export function usersCommand() {
    return new Command('users')
        .description('List people in the workspace')
        .option('--active-only', 'Only active workspace members')
        .action(async (options) => {
            try {
                await withClient(async (client) => {
                    let users = await client.getUsers();
                    if (options.activeOnly) users = users.filter((u) => u.active === true);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', count: users.length, data: users });
                        return;
                    }

                    if (users.length === 0) {
                        printToConsole('No users found.');
                        return;
                    }

                    users.sort((a, b) => a.name.localeCompare(b.name));

                    let output = `USERS (${users.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const u of users) {
                        const status = u.active === null ? 'not a member' : (u.active ? 'active' : 'inactive');
                        output += `  ${u.name} [${status}${u.role ? ', ' + u.role : ''}]\n`;
                        output += `    ID: ${u._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not load users: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });
}
