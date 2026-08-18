import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, formatDate, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload } from '../utils/errors.js';
import { resolveProject, parseDate } from '../resolvers.js';
import { MilestoneStatus } from '../huly-types.js';
import { getMilestoneReport } from '../services/sub-issues.js';

const MILESTONE_STATUS_LABELS: Record<number, string> = {
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
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi: ${e.message}`);
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
                    } else {
                        printToConsole(`Da tao milestone: "${milestone.label}" trong ${project.identifier}\n  ID: ${milestone._id}\n  Target: ${formatDate(milestone.targetDate)}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi khi tao milestone: ${e.message}`);
                process.exitCode = 1;
            }
        });

    cmd.command('report')
        .description('Generate a milestone report grouped by Epic with sub-issue trees')
        .argument('<milestoneId>', 'Milestone internal _id (use `milestones list` to discover)')
        .action(async (milestoneId) => {
            try {
                await withClient(async (client) => {
                    const report = await getMilestoneReport(client, milestoneId);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: report });
                        return;
                    }

                    let output = `MILESTONE REPORT: ${report.milestoneLabel} (${report.project})\n`;
                    output += '='.repeat(70) + '\n';
                    output += `Total issues: ${report.totalIssues}\n`;
                    output += `Estimation: ${report.summary.totalEstimation} | Reported: ${report.summary.totalReported}\n`;
                    output += `Completed: ${report.summary.completedCount} | In progress: ${report.summary.inProgressCount}\n\n`;

                    for (const epic of report.epics) {
                        output += `# ${epic.identifier}: ${epic.title}\n`;
                        output += `  status=${epic.status} | assignee=${epic.assignee || 'N/A'} | children=${epic.childCount} (${epic.completedCount} done)\n`;
                        for (const child of epic.children) {
                            const indent = '  '.repeat(child.level);
                            output += `${indent}- ${child.identifier} [${child.status}]: ${child.title}\n`;
                            for (const gc of child.children) renderChild(gc);
                        }
                        function renderChild(n: any) {
                            const indent = '  '.repeat(n.level);
                            output += `${indent}- ${n.identifier} [${n.status}]: ${n.title}\n`;
                            for (const gc of n.children) renderChild(gc);
                        }
                        output += '\n';
                    }

                    if (report.orphans.length > 0) {
                        output += `ORPHANS (parent ngoai milestone): ${report.orphans.length}\n`;
                        for (const o of report.orphans) {
                            output += `  - ${o.identifier} [${o.status}]: ${o.title}\n`;
                        }
                    }

                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi: ${e.message}`);
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
                    } else {
                        printToConsole(`Da danh dau milestone "${milestoneId}" la hoan thanh.`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });

    return cmd;
}
