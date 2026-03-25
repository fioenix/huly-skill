#!/usr/bin/env node

import 'fake-indexeddb/auto';

// Polyfill minimal browser APIs required by @hcengineering/api-client and client-resources
const globalAny = global as any;
if (typeof globalAny.window === 'undefined') {
    globalAny.window = global;

    // Add methods that client libraries expect to find on window
    globalAny.window.addEventListener = () => { };
    globalAny.window.removeEventListener = () => { };
    globalAny.window.requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    globalAny.window.cancelAnimationFrame = clearTimeout;

    globalAny.window.localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
        clear: () => { }
    };
    globalAny.window.sessionStorage = globalAny.window.localStorage;
    globalAny.window.location = { origin: 'http://localhost' };

    // We only create navigator if it doesn't already exist in newer node versions
    if (typeof globalAny.navigator === 'undefined') {
        globalAny.navigator = { userAgent: 'node' };
    }
}

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { setJsonMode } from './utils/logger.js';
import { listTasksCommand } from './commands/tasks.js';
import { getTaskCommand } from './commands/task.js';
import { createTaskCommand } from './commands/create.js';
import { updateTaskCommand } from './commands/update.js';
import { reportCommand } from './commands/report.js';
import { projectsCommand } from './commands/projects.js';
import { deleteTaskCommand } from './commands/delete.js';
import { whoamiCommand } from './commands/whoami.js';
import { labelsCommand } from './commands/labels.js';
import { documentsCommand } from './commands/documents.js';
import { milestonesCommand } from './commands/milestones.js';

let version = '1.1.0';
try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    version = pkg.version;
} catch {
    // Bundled mode — use hardcoded version
}

const program = new Command();

program
    .name('huly')
    .description('CLI tool to interact with Huly project management')
    .version(version)
    .option('--json', 'Output in JSON format');

program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.json) setJsonMode(true);
});

program.addCommand(listTasksCommand());
program.addCommand(getTaskCommand());
program.addCommand(createTaskCommand());
program.addCommand(updateTaskCommand());
program.addCommand(reportCommand());
program.addCommand(projectsCommand());
program.addCommand(deleteTaskCommand());
program.addCommand(whoamiCommand());
program.addCommand(labelsCommand());
program.addCommand(documentsCommand());
program.addCommand(milestonesCommand());

program.parse(process.argv);
