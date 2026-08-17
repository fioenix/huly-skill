import { HulyClient, CreateTaskOptions, UpdateTaskOptions } from '../client.js';
import {
    resolvePerson,
    resolveProject,
    resolveStatus,
    resolveStatusIds,
    resolveTaskId,
    getActor,
    parsePriority,
    parseDate,
    getProjectMap,
    getStatusMap,
} from '../resolvers.js';

export interface CreateIssueInput {
    title: string;
    project: string;        // identifier, name, or _id
    priority?: string;       // name or number string
    due?: string;            // "today", "tomorrow", or YYYY-MM-DD
    assignee?: string;       // "me", name, or _id
    description?: string;
    kindId?: string;
    componentId?: string;
    milestoneId?: string;
    parent?: string;         // identifier (OMEGA-588) or internal _id
    rawFields?: Record<string, any>;
}

export interface UpdateIssueInput {
    status?: string;         // name or _id
    priority?: string;
    due?: string;
    assignee?: string;
    comment?: string;
    kindId?: string;
    componentId?: string;
    milestoneId?: string;
    rawFields?: Record<string, any>;
    descriptionMarkdown?: string;
}

export interface QueryIssuesInput {
    assignee?: string;
    project?: string;
    status?: string;         // comma-separated names
    overdue?: boolean;
    dueToday?: boolean;
    parent?: string;         // identifier (LAMBD-568) or internal _id
    milestoneId?: string;    // internal milestone _id
}

export interface IssueResult {
    task: any;
    projectIdentifier: string;
    projectName: string;
    assigneeName: string;
}

export async function createIssue(client: HulyClient, input: CreateIssueInput): Promise<IssueResult> {
    const project = await resolveProject(client, input.project);

    // Falls back to HULY_DEFAULT_ASSIGNEE so a shared token does not leave every
    // task unassigned; an explicit --assignee always wins.
    const assignee = input.assignee || process.env.HULY_DEFAULT_ASSIGNEE?.trim() || undefined;

    let assigneeName = 'Chua giao';
    let assigneeId: string | undefined;
    if (assignee) {
        const person = await resolvePerson(client, assignee);
        assigneeId = person._id;
        assigneeName = person.name;
    }

    const parentId = input.parent ? await resolveTaskId(client, input.parent) : undefined;

    // Huly attributes the task to the token's account, which on a shared token
    // is not the person asking. Record who did in the one place that survives:
    // the task itself.
    const actor = getActor();
    const description = actor
        ? `${input.description ? input.description + '\n\n' : ''}Requested by: ${actor}`
        : input.description;

    const taskData: CreateTaskOptions = {
        title: input.title,
        projectId: project._id,
        parentId,
        priority: parsePriority(input.priority),
        dueDate: parseDate(input.due),
        assigneeId,
        description,
        kindId: input.kindId,
        componentId: input.componentId,
        milestoneId: input.milestoneId,
        rawFields: input.rawFields,
    };

    const created = await client.createTask(taskData);

    return {
        task: created,
        projectIdentifier: project.identifier,
        projectName: project.name,
        assigneeName,
    };
}

export async function updateIssue(client: HulyClient, taskId: string, input: UpdateIssueInput): Promise<string[]> {
    const task = await client.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} khong tim thay`);

    const updates: UpdateTaskOptions = {};
    const changes: string[] = [];

    if (input.status) {
        const resolved = await resolveStatus(client, input.status, task.space);
        updates.statusId = resolved._id;
        changes.push(`Trang thai → '${resolved.name}'`);
    }

    if (input.priority !== undefined) {
        updates.priority = parsePriority(input.priority);
        changes.push(`Uu tien → ${updates.priority}`);
    }

    if (input.due) {
        updates.dueDate = parseDate(input.due);
        changes.push(`Han chot → ${input.due}`);
    }

    if (input.assignee) {
        const person = await resolvePerson(client, input.assignee);
        updates.assigneeId = person._id;
        changes.push(`Nguoi thuc hien → ${person.name}`);
    }

    if (input.kindId) {
        updates.kindId = input.kindId;
        changes.push(`Kind → ${input.kindId}`);
    }

    if (input.componentId !== undefined) {
        updates.componentId = input.componentId;
        changes.push(`Component → ${input.componentId}`);
    }

    if (input.milestoneId !== undefined) {
        updates.milestoneId = input.milestoneId;
        changes.push(`Milestone → ${input.milestoneId}`);
    }

    if (input.rawFields && Object.keys(input.rawFields).length > 0) {
        updates.rawFields = input.rawFields;
        for (const [k, v] of Object.entries(input.rawFields)) {
            changes.push(`${k} → ${v}`);
        }
    }

    if (input.descriptionMarkdown) {
        updates.descriptionMarkdown = input.descriptionMarkdown;
        changes.push('Description → (from file)');
    }

    if (Object.keys(updates).length > 0) {
        await client.updateTask(taskId, updates);
    }

    // Verify description update actually persisted
    if (input.descriptionMarkdown) {
        const updated = await client.getTask(taskId);
        if (updated) {
            const actual = await client.fetchMarkup(updated, 'description');
            if (actual) {
                const expectedSnippet = input.descriptionMarkdown.trim().substring(0, 50);
                const actualSnippet = actual.trim().substring(0, 50);
                if (actualSnippet !== expectedSnippet) {
                    throw new Error(
                        `Description update verification failed!\n` +
                        `  Expected: "${expectedSnippet}..."\n` +
                        `  Actual:   "${actualSnippet}..."`
                    );
                }
            }
        }
    }

    if (input.comment) {
        await client.addComment(taskId, input.comment);
        changes.push('Binh luan da them');
    }

    return changes;
}

export interface QueryResult {
    tasks: any[];
    projectMap: Map<string, any>;
    statusMap: Map<string, any>;
}

export async function queryIssues(client: HulyClient, input: QueryIssuesInput): Promise<QueryResult> {
    let assigneeId: string | undefined;
    if (input.assignee) {
        const person = await resolvePerson(client, input.assignee);
        assigneeId = person._id;
    }

    let projectId: string | undefined;
    if (input.project) {
        const project = await resolveProject(client, input.project);
        projectId = project._id;
    }

    let statusIds: string[] | undefined;
    let statusMap: Map<string, any>;
    if (input.status) {
        const result = await resolveStatusIds(client, input.status);
        statusIds = result.ids;
        statusMap = result.statusMap;
    } else {
        statusMap = await getStatusMap(client);
    }

    const projectMap = await getProjectMap(client);

    let parentInternalId: string | undefined;
    if (input.parent) {
        parentInternalId = await resolveTaskId(client, input.parent);
    }

    const tasks = await client.queryTasks({
        assignee: assigneeId,
        projectId,
        statusIds,
        overdue: input.overdue,
        dueToday: input.dueToday,
        parentInternalId,
        milestoneId: input.milestoneId,
    });

    return { tasks, projectMap, statusMap };
}

export function isCompletedStatus(statusName: string): boolean {
    const lower = statusName.toLowerCase();
    return lower.includes('done') || lower.includes('closed') || lower.includes('completed') || lower.includes('resolved');
}

export interface ReportInput {
    type: 'daily' | 'weekly';
    assignee?: string;       // "me", name, or _id
}

export interface ReportResult {
    type: 'daily' | 'weekly';
    assigneeName: string;
    due: any[];
    overdue: any[];
    inProgress: number;
    projectMap: Map<string, any>;
    statusMap: Map<string, any>;
}

/**
 * Build a daily or weekly report: tasks due in the target window plus
 * any overdue tasks. Shared by the CLI `report` command and the MCP
 * `report` tool so the date-bucketing logic lives in exactly one place.
 */
export async function reportIssues(client: HulyClient, input: ReportInput): Promise<ReportResult> {
    let assigneeId: string | undefined;
    let assigneeName = 'Ban';
    if (input.assignee) {
        const person = await resolvePerson(client, input.assignee);
        assigneeId = person._id;
        assigneeName = person.name;
    }

    const tasks = await client.queryTasks({ assignee: assigneeId });
    const projectMap = await getProjectMap(client);
    const statusMap = await getStatusMap(client);

    const isDaily = input.type === 'daily';

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayTime = now.getTime();

    const endOfWeek = new Date();
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);
    const endOfWeekTime = endOfWeek.getTime();

    const overdue: any[] = [];
    const due: any[] = [];
    const inProgress = tasks.filter((task: any) => {
        const s = statusMap.get(task.status)?.name?.toLowerCase() || '';
        return s.includes('progress') || s.includes('doing');
    }).length;

    for (const task of tasks) {
        const statusName = statusMap.get(task.status)?.name || '';
        if (isCompletedStatus(statusName)) continue;
        if (!task.dueDate) continue;

        const d = new Date(task.dueDate);
        d.setHours(0, 0, 0, 0);
        const dueTime = d.getTime();

        if (dueTime < todayTime) {
            overdue.push(task);
        } else if (isDaily && dueTime === todayTime) {
            due.push(task);
        } else if (!isDaily && dueTime >= todayTime && dueTime <= endOfWeekTime) {
            due.push(task);
        }
    }

    due.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    overdue.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

    return { type: input.type, assigneeName, due, overdue, inProgress, projectMap, statusMap };
}
