import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
import { resolveProject, parseDate } from '../resolvers.js';
import { MilestoneStatus } from '../huly-types.js';
const MILESTONE_STATUS_LABELS = {
    [MilestoneStatus.Planned]: 'Planned',
    [MilestoneStatus.InProgress]: 'In Progress',
    [MilestoneStatus.Completed]: 'Completed',
    [MilestoneStatus.Cancelled]: 'Cancelled',
};
export function milestonesCommand() {
    const cmd = new Command('milestones')
        .description('Manage project milestones');
    cmd.command('list')
        .description('List milestones in a project')
        .requiredOption('-p, --project <project>', 'Project identifier (e.g., DELTA)')
        .action(async (options) => {
        try {
            await withClient(async (client) => {
                const project = await resolveProject(client, options.project);
                const milestones = await client.getMilestones(project._id);
                if (isJsonMode()) {
                    outputJson({ status: 'ok', project: project.identifier, count: milestones.length, data: milestones });
                    return;
                }
                if (milestones.length === 0) {
                    printToConsole(`Du an ${project.identifier} khong co milestone nao.`);
                    return;
                }
                let output = `MILESTONES - ${project.identifier} (${milestones.length})\n`;
                output += '='.repeat(50) + '\n';
                for (const m of milestones) {
                    const statusLabel = MILESTONE_STATUS_LABELS[m.status] || 'Unknown';
                    output += `  ${m.label} [${statusLabel}]\n`;
                    output += `    ID: ${m._id}\n`;
                    output += `    Target: ${formatDate(m.targetDate)}\n`;
                }
                printToConsole(output);
            });
        }
        catch (e) {
            if (isJsonMode())
                outputJson({ status: 'error', error: e.message });
            else
                console.error(`Loi: ${e.message}`);
            process.exitCode = 1;
        }
    });
    cmd.command('create')
        .description('Create a new milestone')
        .argument('<label>', 'Milestone label/name')
        .requiredOption('-p, --project <project>', 'Project identifier')
        .option('--target <date>', 'Target date (YYYY-MM-DD, "today", "tomorrow")')
        .action(async (label, options) => {
        try {
            await withClient(async (client) => {
                const project = await resolveProject(client, options.project);
                const targetDate = parseDate(options.target) || (Date.now() + 14 * 24 * 60 * 60 * 1000); // default: 2 weeks
                const milestone = await client.createMilestone(project._id, label, targetDate);
                if (isJsonMode()) {
                    outputJson({ status: 'ok', data: milestone });
                }
                else {
                    printToConsole(`Da tao milestone: "${milestone.label}" trong ${project.identifier}\n  ID: ${milestone._id}\n  Target: ${formatDate(milestone.targetDate)}`);
                }
            });
        }
        catch (e) {
            if (isJsonMode())
                outputJson({ status: 'error', error: e.message });
            else
                console.error(`Loi khi tao milestone: ${e.message}`);
            process.exitCode = 1;
        }
    });
    cmd.command('complete')
        .description('Mark a milestone as completed')
        .argument('<milestoneId>', 'Milestone ID')
        .requiredOption('-p, --project <project>', 'Project identifier')
        .action(async (milestoneId, options) => {
        try {
            await withClient(async (client) => {
                const project = await resolveProject(client, options.project);
                await client.updateMilestone(project._id, milestoneId, {
                    status: MilestoneStatus.Completed,
                });
                if (isJsonMode()) {
                    outputJson({ status: 'ok', milestoneId, action: 'completed' });
                }
                else {
                    printToConsole(`Da danh dau milestone "${milestoneId}" la hoan thanh.`);
                }
            });
        }
        catch (e) {
            if (isJsonMode())
                outputJson({ status: 'error', error: e.message });
            else
                console.error(`Loi: ${e.message}`);
            process.exitCode = 1;
        }
    });
    return cmd;
}
