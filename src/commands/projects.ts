import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, formatDate } from '../utils/logger.js';

export function projectsCommand() {
    return new Command('projects')
        .description('List all available projects in the workspace')
        .action(async () => {
            const client = new HulyClient();
            try {
                await client.connect();

                const projects = await client.getProjects();

                if (!projects || projects.length === 0) {
                    printToConsole('✅ Không tìm thấy dự án nào trong không gian làm việc.');
                    return;
                }

                // Sort projects by ID or name
                projects.sort((a, b) => (a.identifier || '').localeCompare(b.identifier || ''));

                let output = `📋 DANH SÁCH DỰ ÁN (${projects.length})\n`;
                output += '━'.repeat(60) + '\n';

                for (const p of projects) {
                    output += `📌 [${p.identifier || 'N/A'}] ${p.name || 'Không có tên'}\n`;
                    output += `   🆔 ID: ${p._id}\n`;
                    output += `   📅 Cập nhật: ${p.modifiedOn ? formatDate(p.modifiedOn) : 'N/A'}\n`;
                    output += `   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                }

                printToConsole(output);
            } catch (e: any) {
                console.error(`❌ Lỗi khi tải danh sách dự án: ${e.message}`);
            } finally {
                await client.disconnect();
            }
        });
}
