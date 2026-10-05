// Offline fixture replay. Never loads Huly credentials or connects to Huly.
import { readFileSync } from 'node:fs';
process.stdout.write(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8'));
