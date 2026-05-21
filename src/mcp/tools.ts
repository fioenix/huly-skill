import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withClient, HulyClient } from '../client.js';
import {
    createIssue,
    updateIssue,
    queryIssues,
    reportIssues,
    isCompletedStatus,
} from '../services/issues.js';
import { resolveProject, parseDate } from '../resolvers.js';
import { MilestoneStatus } from '../huly-types.js';

// --- result helpers --------------------------------------------------------

type ToolResult = {
    content: { type: 'text'; text: string }[];
    isError?: boolean;
};

function toResult(payload: any): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: payload?.status === 'error',
    };
}

/**
 * Run a unit of work against a connected Huly client and wrap the outcome in
 * the `{ status: 'ok' | 'error' }` envelope the CLI already uses, so MCP and
 * CLI consumers see an identical response shape.
 */
async function withHuly(fn: (client: HulyClient) => Promise<Record<string, any>>): Promise<ToolResult> {
    try {
        const data = await withClient(fn);
        return toResult({ status: 'ok', ...data });
    } catch (e: any) {
        return toResult({ status: 'error', error: e?.message || String(e) });
    }
}

async function resolveTeamspace(client: HulyClient, input: string): Promise<any> {
    const teamspaces = await client.getTeamspaces();
    const ts = teamspaces.find((t: any) => t.name === input || t._id === input);
    if (!ts) throw new Error(`Khong tim thay teamspace: ${input}`);
    return ts;
}

// --- tool registration -----------------------------------------------------

/**
 * Register every Huly tool onto the given MCP server. Tools mirror the CLI
 * commands one-to-one and return the same JSON envelope, so behaviour stays
 * consistent across the CLI and MCP adapters.
 */
export function registerHulyTools(server: McpServer): void {
    server.registerTool(
        'huly_whoami',
        {
            title: 'Verify Huly connection',
            description: 'Verify the connection to Huly and return the authenticated account info.',
            inputSchema: {},
        },
        async () => withHuly(async (client) => {
            const account = await client.getAccount();
            return {
                host: process.env.HULY_HOST,
                workspace: process.env.HULY_WORKSPACE_ID,
                account,
            };
        }),
    );

    server.registerTool(
        'huly_list_projects',
        {
            title: 'List projects',
            description: 'List all projects in the Huly workspace.',
            inputSchema: {},
        },
        async () => withHuly(async (client) => {
            const projects = await client.getProjects();
            return { count: projects.length, projects };
        }),
    );

    server.registerTool(
        'huly_list_tasks',
        {
            title: 'List tasks',
            description: 'List tasks with optional filters. By default completed tasks are excluded unless a status filter is given.',
            inputSchema: {
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                project: z.string().optional().describe('Project identifier, name, or _id'),
                status: z.string().optional().describe('Comma-separated status names or IDs'),
                overdue: z.boolean().optional().describe('Only tasks past their due date'),
                dueToday: z.boolean().optional().describe('Only tasks due today'),
            },
        },
        async (args) => withHuly(async (client) => {
            const { tasks, projectMap, statusMap } = await queryIssues(client, args);
            const active = tasks.filter((task: any) => {
                if (args.status) return true;
                const statusName = statusMap.get(task.status)?.name || '';
                return !isCompletedStatus(statusName);
            });
            active.sort((a: any, b: any) => (a.dueDate || 0) - (b.dueDate || 0));
            const enriched = active.map((task: any) => ({
                ...task,
                projectName: projectMap.get(task.space)?.name || null,
                statusName: statusMap.get(task.status)?.name || null,
            }));
            return { count: enriched.length, tasks: enriched };
        }),
    );

    server.registerTool(
        'huly_get_task',
        {
            title: 'Get task detail',
            description: 'Get full details for a single task by its identifier (e.g. DELTA-123), including the description as markdown.',
            inputSchema: {
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
            },
        },
        async ({ taskId }) => withHuly(async (client) => {
            const task = await client.getTask(taskId);
            if (!task) throw new Error(`Task not found: ${taskId}`);
            let description: string | null = null;
            if (task.description) {
                try { description = await client.fetchMarkup(task, 'description'); } catch { /* ignore */ }
            }
            return { task: { ...task, descriptionMarkdown: description } };
        }),
    );

    server.registerTool(
        'huly_create_task',
        {
            title: 'Create task',
            description: 'Create a new task in a project.',
            inputSchema: {
                title: z.string().describe('Task title'),
                project: z.string().describe('Project identifier, name, or _id'),
                priority: z.string().optional().describe('0-4, or LOW/MEDIUM/HIGH/URGENT'),
                due: z.string().optional().describe('YYYY-MM-DD, "today", or "tomorrow"'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                description: z.string().optional().describe('Markdown description'),
                kindId: z.string().optional(),
                componentId: z.string().optional(),
                milestoneId: z.string().optional(),
            },
        },
        async (args) => withHuly(async (client) => {
            const result = await createIssue(client, args);
            return { task: result.task, projectIdentifier: result.projectIdentifier, assigneeName: result.assigneeName };
        }),
    );

    server.registerTool(
        'huly_update_task',
        {
            title: 'Update task',
            description: 'Update a task by identifier. Only the provided fields are changed.',
            inputSchema: {
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                status: z.string().optional().describe('New status name or _id'),
                priority: z.string().optional().describe('0-4, or LOW/MEDIUM/HIGH/URGENT'),
                due: z.string().optional().describe('YYYY-MM-DD, "today", or "tomorrow"'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                descriptionMarkdown: z.string().optional().describe('Replace the description with this markdown'),
                comment: z.string().optional().describe('Add a comment to the task'),
                kindId: z.string().optional(),
                componentId: z.string().optional(),
                milestoneId: z.string().optional(),
            },
        },
        async ({ taskId, ...rest }) => withHuly(async (client) => {
            const changes = await updateIssue(client, taskId, rest);
            return { taskId, changes };
        }),
    );

    server.registerTool(
        'huly_delete_task',
        {
            title: 'Delete task',
            description: 'Permanently delete a task. This cannot be undone — set confirm=true to proceed.',
            inputSchema: {
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                confirm: z.boolean().describe('Must be true to actually delete'),
            },
        },
        async ({ taskId, confirm }) => {
            if (!confirm) {
                return toResult({ status: 'error', error: `Deletion not confirmed. Re-call with confirm=true to permanently delete ${taskId}.` });
            }
            return withHuly(async (client) => {
                const task = await client.getTask(taskId);
                if (!task) throw new Error(`Task not found: ${taskId}`);
                await client.deleteTask(taskId);
                return { deleted: { identifier: task.identifier, title: task.title } };
            });
        },
    );

    server.registerTool(
        'huly_report',
        {
            title: 'Daily/weekly report',
            description: 'Generate a daily or weekly task report: tasks due in the window plus overdue tasks.',
            inputSchema: {
                type: z.enum(['daily', 'weekly']).describe('Report window'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me" (default: "me")'),
            },
        },
        async ({ type, assignee }) => withHuly(async (client) => {
            const report = await reportIssues(client, { type, assignee: assignee ?? 'me' });
            return {
                type: report.type,
                assignee: report.assigneeName,
                due: report.due,
                overdue: report.overdue,
                inProgress: report.inProgress,
            };
        }),
    );

    server.registerTool(
        'huly_list_labels',
        {
            title: 'List labels',
            description: 'List all labels/tags in the workspace.',
            inputSchema: {},
        },
        async () => withHuly(async (client) => {
            const labels = await client.getAllLabels();
            return { count: labels.length, labels };
        }),
    );

    server.registerTool(
        'huly_create_label',
        {
            title: 'Create label',
            description: 'Create a new label/tag.',
            inputSchema: {
                title: z.string().describe('Label title'),
                color: z.number().int().min(0).max(15).optional().describe('Color index 0-15 (default 11)'),
            },
        },
        async ({ title, color }) => withHuly(async (client) => {
            const label = await client.createLabel(title, color ?? 11);
            return { label };
        }),
    );

    server.registerTool(
        'huly_assign_label',
        {
            title: 'Assign label',
            description: 'Assign an existing label to a task.',
            inputSchema: {
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                labelId: z.string().describe('Label _id'),
                title: z.string().optional().describe('Display title for the label reference'),
                color: z.number().int().min(0).max(15).optional(),
            },
        },
        async ({ taskId, labelId, title, color }) => withHuly(async (client) => {
            const task = await client.getTask(taskId);
            if (!task) throw new Error(`Task not found: ${taskId}`);
            const displayTitle = title || labelId;
            await client.assignLabel(task._id, task.space, labelId, displayTitle, color ?? 11);
            return { taskId, labelId };
        }),
    );

    server.registerTool(
        'huly_show_labels',
        {
            title: 'Show task labels',
            description: 'Show the labels assigned to a task.',
            inputSchema: {
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
            },
        },
        async ({ taskId }) => withHuly(async (client) => {
            const task = await client.getTask(taskId);
            if (!task) throw new Error(`Task not found: ${taskId}`);
            const labels = await client.getLabels(task._id);
            return { taskId, count: labels.length, labels };
        }),
    );

    server.registerTool(
        'huly_list_teamspaces',
        {
            title: 'List teamspaces',
            description: 'List all document teamspaces.',
            inputSchema: {},
        },
        async () => withHuly(async (client) => {
            const teamspaces = await client.getTeamspaces();
            return { count: teamspaces.length, teamspaces };
        }),
    );

    server.registerTool(
        'huly_list_documents',
        {
            title: 'List documents',
            description: 'List documents within a teamspace.',
            inputSchema: {
                teamspace: z.string().describe('Teamspace name or _id'),
            },
        },
        async ({ teamspace }) => withHuly(async (client) => {
            const ts = await resolveTeamspace(client, teamspace);
            const docs = await client.getDocuments(ts._id);
            return { teamspace: ts.name, count: docs.length, documents: docs };
        }),
    );

    server.registerTool(
        'huly_read_document',
        {
            title: 'Read document',
            description: 'Read a document\'s content as markdown. Title match is case-insensitive and partial.',
            inputSchema: {
                teamspace: z.string().describe('Teamspace name or _id'),
                title: z.string().describe('Document title (partial match) or _id'),
            },
        },
        async ({ teamspace, title }) => withHuly(async (client) => {
            const ts = await resolveTeamspace(client, teamspace);
            const docs = await client.getDocuments(ts._id);
            const titleLower = title.toLowerCase();
            const doc = docs.find((d: any) => d.title?.toLowerCase().includes(titleLower) || d._id === title);
            if (!doc) throw new Error(`Khong tim thay tai lieu: "${title}"`);
            const content = await client.getDocumentContent(doc);
            return { document: { ...doc, markdownContent: content } };
        }),
    );

    server.registerTool(
        'huly_create_document',
        {
            title: 'Create document',
            description: 'Create a new document in a teamspace.',
            inputSchema: {
                teamspace: z.string().describe('Teamspace name or _id'),
                title: z.string().describe('Document title'),
                content: z.string().optional().describe('Markdown content'),
            },
        },
        async ({ teamspace, title, content }) => withHuly(async (client) => {
            const ts = await resolveTeamspace(client, teamspace);
            const doc = await client.createDocument(ts._id, title, content || '');
            return { document: doc, teamspace: ts.name };
        }),
    );

    server.registerTool(
        'huly_create_teamspace',
        {
            title: 'Create teamspace',
            description: 'Create a new document teamspace.',
            inputSchema: {
                name: z.string().describe('Teamspace name'),
                description: z.string().optional(),
                private: z.boolean().optional().describe('Make the teamspace private'),
            },
        },
        async ({ name, description, private: isPrivate }) => withHuly(async (client) => {
            const ts = await client.createTeamspace(name, description || '', isPrivate ?? false);
            return { teamspace: ts };
        }),
    );

    server.registerTool(
        'huly_list_milestones',
        {
            title: 'List milestones',
            description: 'List milestones in a project.',
            inputSchema: {
                project: z.string().describe('Project identifier, name, or _id'),
            },
        },
        async ({ project }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            const milestones = await client.getMilestones(resolved._id);
            return { project: resolved.identifier, count: milestones.length, milestones };
        }),
    );

    server.registerTool(
        'huly_create_milestone',
        {
            title: 'Create milestone',
            description: 'Create a milestone in a project. Defaults the target date to two weeks out.',
            inputSchema: {
                project: z.string().describe('Project identifier, name, or _id'),
                label: z.string().describe('Milestone label/name'),
                target: z.string().optional().describe('Target date: YYYY-MM-DD, "today", or "tomorrow"'),
            },
        },
        async ({ project, label, target }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            const targetDate = parseDate(target) || (Date.now() + 14 * 24 * 60 * 60 * 1000);
            const milestone = await client.createMilestone(resolved._id, label, targetDate);
            return { milestone };
        }),
    );

    server.registerTool(
        'huly_complete_milestone',
        {
            title: 'Complete milestone',
            description: 'Mark a milestone as completed.',
            inputSchema: {
                project: z.string().describe('Project identifier, name, or _id'),
                milestoneId: z.string().describe('Milestone _id'),
            },
        },
        async ({ project, milestoneId }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            await client.updateMilestone(resolved._id, milestoneId, { status: MilestoneStatus.Completed });
            return { milestoneId, action: 'completed' };
        }),
    );
}
