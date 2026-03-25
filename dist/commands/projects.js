import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
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
                    printToConsole('✅ Khong tim thay du an nao trong khong gian lam viec.');
                    return;
                }
                projects.sort((a, b) => (a.identifier || '').localeCompare(b.identifier || ''));
                let output = `📋 DANH SACH DU AN (${projects.length})\n`;
                output += '━'.repeat(60) + '\n';
                for (const p of projects) {
                    output += `📌 [${p.identifier || 'N/A'}] ${p.name || 'Khong co ten'}\n`;
                    output += `   🆔 ID: ${p._id}\n`;
                    output += `   📅 Cap nhat: ${p.modifiedOn ? formatDate(p.modifiedOn) : 'N/A'}\n`;
                    output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                }
                printToConsole(output);
            });
        }
        catch (e) {
            if (isJsonMode())
                outputJson({ status: 'error', error: e.message });
            else
                console.error(`❌ Loi khi tai danh sach du an: ${e.message}`);
            process.exitCode = 1;
        }
    });
}
