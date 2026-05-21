import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Auto-load a `.env` file into process.env. Search order (first match wins):
 *   1. ~/.huly/.env  — primary; writable everywhere incl. the Cowork sandbox
 *   2. <binDir>/.env — fallback for Claude Desktop / direct install
 *   3. <cwd>/.env
 * Existing environment variables always take precedence over file values.
 */
export function loadEnvFile(): void {
    const candidates: string[] = [];

    try {
        candidates.push(join(homedir(), '.huly', '.env'));
    } catch {
        // homedir() can fail in exotic environments — skip.
    }

    try {
        const binDir = (typeof __dirname !== 'undefined' ? __dirname : undefined) ?? dirname(process.argv[1]);
        candidates.push(join(binDir, '.env'));
        candidates.push(join(binDir, '..', '.env'));
    } catch {
        // Bundled mode may not resolve __dirname — skip.
    }

    candidates.push(join(process.cwd(), '.env'));

    for (const envPath of candidates) {
        if (!existsSync(envPath)) continue;
        try {
            const content = readFileSync(envPath, 'utf-8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex === -1) continue;
                const key = trimmed.slice(0, eqIndex).trim();
                let value = trimmed.slice(eqIndex + 1).trim();
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
            // Ignore read errors, try the next candidate.
        }
    }
}
