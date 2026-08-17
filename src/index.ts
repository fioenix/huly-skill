#!/usr/bin/env node

// Bootstrap (proxy + browser-API polyfills) must load before anything that
// touches the network or @hcengineering/api-client.
import './bootstrap.js';
import { loadEnvFile } from './env.js';
loadEnvFile();

import { Command } from 'commander';
import { VERSION } from './version.js';
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
import { listSubIssuesCommand, getTaskByIdCommand } from './commands/sub-issues.js';
import { activityCommand } from './commands/activity.js';
import { commentsCommand } from './commands/comments.js';
import { kindsCommand } from './commands/kinds.js';
import { usersCommand } from './commands/users.js';

const program = new Command();

program
    .name('huly')
    .description('CLI tool to interact with Huly project management')
    .version(VERSION)
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
program.addCommand(listSubIssuesCommand());
program.addCommand(getTaskByIdCommand());
program.addCommand(activityCommand());
program.addCommand(commentsCommand());
program.addCommand(kindsCommand());
program.addCommand(usersCommand());

program.parse(process.argv);
