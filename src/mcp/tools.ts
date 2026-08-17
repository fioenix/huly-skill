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
import { getSubIssueTree, getMilestoneReport } from '../services/sub-issues.js';
import { getIssueActivity } from '../services/activity.js';
import { listComments, getCommentById } from '../services/comments.js';

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
            inputSchema: z.object({}).strict(),
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
            inputSchema: z.object({}).strict(),
        },
        async () => withHuly(async (client) => {
            const projects = await client.getProjects();
            return { count: projects.length, projects };
        }),
    );

    server.registerTool(
        'huly_list_users',
        {
            title: 'List users',
            description: 'List people in the workspace. Use a returned `_id` as the `assignee` argument of huly_create_task / huly_update_task.',
            inputSchema: z.object({
                activeOnly: z.boolean().optional().describe('Only workspace members that are active (default false — returns everyone)'),
            }).strict(),
        },
        async ({ activeOnly }) => withHuly(async (client) => {
            let users = await client.getUsers();
            if (activeOnly) users = users.filter((u) => u.active === true);
            return { count: users.length, users };
        }),
    );

    server.registerTool(
        'huly_list_tasks',
        {
            title: 'List tasks',
            description: 'List tasks with optional filters. By default completed tasks are excluded unless a status filter is given. Pass `parentId` to fetch only direct children of a parent task.',
            inputSchema: z.object({
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                project: z.string().optional().describe('Project identifier, name, or _id'),
                status: z.string().optional().describe('Comma-separated status names or IDs'),
                overdue: z.boolean().optional().describe('Only tasks past their due date'),
                dueToday: z.boolean().optional().describe('Only tasks due today'),
                parentId: z.string().optional().describe('Parent task identifier (e.g. LAMBD-568) or internal _id — returns direct children only'),
                milestoneId: z.string().optional().describe('Filter by milestone internal _id'),
            }).strict(),
        },
        async (args) => withHuly(async (client) => {
            const { tasks, projectMap, statusMap } = await queryIssues(client, {
                ...args,
                parent: args.parentId,
            });
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
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
            }).strict(),
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
            description: 'Create a new task in a project. Pass `parentId` to create it as a sub-issue of an existing task.',
            // Strict: an unknown argument is rejected instead of dropped. A
            // silently ignored `parentId` used to return ok while creating a
            // top-level task, which reads as success and is not.
            inputSchema: z.object({
                title: z.string().describe('Task title'),
                project: z.string().describe('Project identifier, name, or _id'),
                parentId: z.string().optional().describe('Parent task identifier (e.g. OMEGA-588) or internal _id — creates this task as its sub-issue. Must be in the same project.'),
                parent: z.string().optional().describe('Alias of parentId.'),
                priority: z.string().optional().describe('0-4, or LOW/MEDIUM/HIGH/URGENT'),
                due: z.string().optional().describe('YYYY-MM-DD, "today", or "tomorrow"'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                description: z.string().optional().describe('Markdown description'),
                kindId: z.string().optional().describe('Task type _id from huly_list_task_kinds. Defaults to the standard Issue type.'),
                componentId: z.string().optional().describe('Component _id'),
                milestoneId: z.string().optional().describe('Milestone _id from huly_list_milestones'),
            }).strict(),
        },
        async ({ parentId, parent, ...rest }) => withHuly(async (client) => {
            const result = await createIssue(client, { ...rest, parent: parentId ?? parent });
            return { task: result.task, projectIdentifier: result.projectIdentifier, assigneeName: result.assigneeName };
        }),
    );

    server.registerTool(
        'huly_update_task',
        {
            title: 'Update task',
            description: 'Update a task by identifier. Only the provided fields are changed.',
            // Strict for the same reason as huly_create_task: a dropped field
            // would report success while changing nothing.
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                status: z.string().optional().describe('New status name or _id'),
                priority: z.string().optional().describe('0-4, or LOW/MEDIUM/HIGH/URGENT'),
                due: z.string().optional().describe('YYYY-MM-DD, "today", or "tomorrow"'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me"'),
                descriptionMarkdown: z.string().optional().describe('Replace the description with this markdown'),
                comment: z.string().optional().describe('Add a comment to the task'),
                kindId: z.string().optional().describe('Task type _id from huly_list_task_kinds'),
                componentId: z.string().optional().describe('Component _id'),
                milestoneId: z.string().optional().describe('Milestone _id from huly_list_milestones'),
            }).strict(),
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
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                confirm: z.boolean().describe('Must be true to actually delete'),
            }).strict(),
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
            inputSchema: z.object({
                type: z.enum(['daily', 'weekly']).describe('Report window'),
                assignee: z.string().optional().describe('Assignee ID, name, or "me" (default: "me")'),
            }).strict(),
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
            inputSchema: z.object({}).strict(),
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
            inputSchema: z.object({
                title: z.string().describe('Label title'),
                color: z.number().int().min(0).max(15).optional().describe('Color index 0-15 (default 11)'),
            }).strict(),
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
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
                labelId: z.string().describe('Label _id'),
                title: z.string().optional().describe('Display title for the label reference'),
                color: z.number().int().min(0).max(15).optional(),
            }).strict(),
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
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. DELTA-123'),
            }).strict(),
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
            inputSchema: z.object({}).strict(),
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
            inputSchema: z.object({
                teamspace: z.string().describe('Teamspace name or _id'),
            }).strict(),
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
            inputSchema: z.object({
                teamspace: z.string().describe('Teamspace name or _id'),
                title: z.string().describe('Document title (partial match) or _id'),
            }).strict(),
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
            inputSchema: z.object({
                teamspace: z.string().describe('Teamspace name or _id'),
                title: z.string().describe('Document title'),
                content: z.string().optional().describe('Markdown content'),
            }).strict(),
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
            inputSchema: z.object({
                name: z.string().describe('Teamspace name'),
                description: z.string().optional(),
                private: z.boolean().optional().describe('Make the teamspace private'),
            }).strict(),
        },
        async ({ name, description, private: isPrivate }) => withHuly(async (client) => {
            const ts = await client.createTeamspace(name, description || '', isPrivate ?? false);
            return { teamspace: ts };
        }),
    );

    server.registerTool(
        'huly_list_task_kinds',
        {
            title: 'List task kinds',
            description: 'List the task types (kinds) available in a project — e.g. Task, Bug, EPIC, KPI. Use a returned `_id` as the `kindId` argument of huly_create_task / huly_update_task.',
            inputSchema: z.object({
                project: z.string().describe('Project identifier, name, or _id'),
            }).strict(),
        },
        async ({ project }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            const kinds = await client.getTaskKinds(resolved._id);
            return {
                project: resolved.identifier,
                count: kinds.length,
                kinds: kinds.map((k: any) => ({ _id: k._id, name: k.name, kind: k.kind })),
            };
        }),
    );

    server.registerTool(
        'huly_list_milestones',
        {
            title: 'List milestones',
            description: 'List milestones in a project.',
            inputSchema: z.object({
                project: z.string().describe('Project identifier, name, or _id'),
            }).strict(),
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
            inputSchema: z.object({
                project: z.string().describe('Project identifier, name, or _id'),
                label: z.string().describe('Milestone label/name'),
                target: z.string().optional().describe('Target date: YYYY-MM-DD, "today", or "tomorrow"'),
            }).strict(),
        },
        async ({ project, label, target }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            const targetDate = parseDate(target) || (Date.now() + 14 * 24 * 60 * 60 * 1000);
            const milestone = await client.createMilestone(resolved._id, label, targetDate);
            return { milestone };
        }),
    );

    server.registerTool(
        'huly_list_sub_issues',
        {
            title: 'List sub-issues (tree)',
            description: 'Recursively list all sub-issues of a parent task by identifier. Returns a tree by default; set flat=true for a flat list. Solves the "huly_list_tasks only returns top-level" pain.',
            inputSchema: z.object({
                taskId: z.string().describe('Parent task identifier, e.g. LAMBD-568'),
                recursive: z.boolean().optional().describe('Walk grandchildren (default true)'),
                flat: z.boolean().optional().describe('Return a flat list instead of a tree (default false)'),
            }).strict(),
        },
        async ({ taskId, recursive, flat }) => withHuly(async (client) => {
            const result = await getSubIssueTree(client, taskId, recursive !== false);
            return {
                parent: result.parent,
                totalCount: result.totalCount,
                directChildren: result.directChildren,
                data: flat ? result.flat : result.data,
            };
        }),
    );

    server.registerTool(
        'huly_get_task_by_id',
        {
            title: 'Get task by internal _id',
            description: 'Look up a task by its internal _id (the kind of id stored in childInfo[].childId), not by human identifier like LAMBD-568.',
            inputSchema: z.object({
                internalId: z.string().describe('Internal task _id'),
            }).strict(),
        },
        async ({ internalId }) => withHuly(async (client) => {
            const task = await client.getTaskByInternalId(internalId);
            if (!task) throw new Error(`Task not found for _id: ${internalId}`);
            return { task };
        }),
    );

    server.registerTool(
        'huly_get_activity',
        {
            title: 'Get task activity feed',
            description: 'Return the activity timeline of an issue: DocUpdateMessage events (status/assignee/label changes with from→to) plus ChatMessage comments. Sorted newest first.',
            inputSchema: z.object({
                taskId: z.string().describe('Task identifier, e.g. LAMBD-568'),
                limit: z.number().int().min(1).max(1000).optional().describe('Max events per kind (default 200)'),
                kind: z.enum(['all', 'updates', 'comments']).optional().describe('Filter feed kind (default all)'),
            }).strict(),
        },
        async ({ taskId, limit, kind }) => withHuly(async (client) => {
            const result = await getIssueActivity(client, taskId, limit ?? 200);
            let events = result.events;
            if (kind === 'updates') events = events.filter((e) => e.kind === 'update');
            else if (kind === 'comments') events = events.filter((e) => e.kind === 'comment');
            return {
                task: result.taskIdentifier,
                count: events.length,
                events,
            };
        }),
    );

    server.registerTool(
        'huly_get_comments',
        {
            title: 'List comments on any object',
            description: 'List comments attached to any Huly object (issue, milestone, document, component, project) by its internal _id. Unlike huly_get_activity (issue-only), this works for milestones and other classes. Returns comment body (markdown), author and timestamps, newest first; thread replies are nested under their parent comment in `replies`.',
            inputSchema: z.object({
                targetId: z.string().describe('Internal _id of the parent object. For milestones use huly_list_milestones to get _id; the _id is also the path segment before "|" in a chunter link.'),
                targetClass: z.string().optional().describe('Optional parent class filter: friendly alias (issue|milestone|component|project|document) or raw ref like "tracker:class:Milestone". Omit to match any class on that _id.'),
                limit: z.number().int().min(1).max(1000).optional().describe('Max comments (default 200)'),
            }).strict(),
        },
        async ({ targetId, targetClass, limit }) => withHuly(async (client) => {
            const comments = await listComments(client, targetId, targetClass, limit ?? 200);
            return { count: comments.length, comments };
        }),
    );

    server.registerTool(
        'huly_get_comment',
        {
            title: 'Get a single comment by id',
            description: 'Resolve one ChatMessage comment by its _id — e.g. the "message" query param of a Huly chunter deep-link. Returns the comment body (markdown), author, timestamps, and any thread replies nested in `replies`.',
            inputSchema: z.object({
                messageId: z.string().describe('ChatMessage _id, e.g. the value of the "message" query param in a chunter link'),
            }).strict(),
        },
        async ({ messageId }) => withHuly(async (client) => {
            const comment = await getCommentById(client, messageId);
            if (!comment) throw new Error(`Khong tim thay comment: ${messageId}`);
            return { comment };
        }),
    );

    server.registerTool(
        'huly_milestone_report',
        {
            title: 'Milestone report (grouped by Epic)',
            description: 'List every issue in a milestone, group by Epic, walk sub-issues recursively. Output is shaped for KPI checkin and pitstop reviews.',
            inputSchema: z.object({
                milestoneId: z.string().describe('Internal milestone _id (use huly_list_milestones to discover)'),
            }).strict(),
        },
        async ({ milestoneId }) => withHuly(async (client) => {
            const report = await getMilestoneReport(client, milestoneId);
            return { report };
        }),
    );

    server.registerTool(
        'huly_complete_milestone',
        {
            title: 'Complete milestone',
            description: 'Mark a milestone as completed.',
            inputSchema: z.object({
                project: z.string().describe('Project identifier, name, or _id'),
                milestoneId: z.string().describe('Milestone _id'),
            }).strict(),
        },
        async ({ project, milestoneId }) => withHuly(async (client) => {
            const resolved = await resolveProject(client, project);
            await client.updateMilestone(resolved._id, milestoneId, { status: MilestoneStatus.Completed });
            return { milestoneId, action: 'completed' };
        }),
    );
}
