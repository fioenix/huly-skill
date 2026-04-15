#!/usr/bin/env node

// Proxy support — must run before any network calls.
// Bundled into bundle.cjs by esbuild so undici is always available.
import { ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

const _proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (_proxyUrl) {
    const _agent = new ProxyAgent(_proxyUrl);
    setGlobalDispatcher(_agent);
    // Monkey-patch globalThis.fetch — Node.js built-in fetch uses its own
    // internal undici instance which setGlobalDispatcher may not reach.
    (globalThis as any).fetch = (url: any, opts: any = {}) => {
        return undiciFetch(url, { ...opts, dispatcher: _agent });
    };
}

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

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { Command } from 'commander';
import { setJsonMode } from './utils/logger.js';

// Auto-load .env file. Search order:
// 1. __dirname/.env        (skill dir — works in Claude Desktop / direct install)
// 2. ~/.huly/.env           (user home — writable in Cowork sandbox)
// 3. cwd/.env               (working directory)
// First file found wins. Existing env vars always take precedence.
function loadEnvFile() {
    const candidates: string[] = [];

    // 1. Skill directory (next to binary)
    try {
        const binDir = __dirname ?? dirname(process.argv[1]);
        candidates.push(join(binDir, '.env'));
        candidates.push(join(binDir, '..', '.env'));
    } catch {
        // Ignore — bundled mode may not resolve __dirname
    }

    // 2. ~/.huly/.env (Cowork sandbox: skill dir is read-only, home is writable)
    try {
        candidates.push(join(homedir(), '.huly', '.env'));
    } catch {
        // Ignore — homedir() can fail in exotic envs
    }

    // 3. Working directory
    candidates.push(join(process.cwd(), '.env'));

    for (const envPath of candidates) {
        if (existsSync(envPath)) {
            try {
                const content = readFileSync(envPath, 'utf-8');
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const eqIndex = trimmed.indexOf('=');
                    if (eqIndex === -1) continue;
                    const key = trimmed.slice(0, eqIndex).trim();
                    let value = trimmed.slice(eqIndex + 1).trim();
                    // Strip surrounding quotes
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    if (!(key in process.env)) {
                        process.env[key] = value;
                    }
                }
                return;
            } catch {
                // Ignore read errors, try next candidate
            }
        }
    }
}
loadEnvFile();
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
