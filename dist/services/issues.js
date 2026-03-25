import { resolvePerson, resolveProject, resolveStatus, resolveStatusIds, parsePriority, parseDate, getProjectMap, getStatusMap, } from '../resolvers.js';
export async function createIssue(client, input) {
    const project = await resolveProject(client, input.project);
    let assigneeName = 'Chua giao';
    let assigneeId;
    if (input.assignee) {
        const person = await resolvePerson(client, input.assignee);
        assigneeId = person._id;
        assigneeName = person.name;
    }
    const taskData = {
        title: input.title,
        projectId: project._id,
        priority: parsePriority(input.priority),
        dueDate: parseDate(input.due),
        assigneeId,
        description: input.description,
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
export async function updateIssue(client, taskId, input) {
    const task = await client.getTask(taskId);
    if (!task)
        throw new Error(`Task ${taskId} khong tim thay`);
    const updates = {};
    const changes = [];
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
    if (input.comment) {
        await client.addComment(taskId, input.comment);
        changes.push('Binh luan da them');
    }
    return changes;
}
export async function queryIssues(client, input) {
    let assigneeId;
    if (input.assignee) {
        const person = await resolvePerson(client, input.assignee);
        assigneeId = person._id;
    }
    let projectId;
    if (input.project) {
        const project = await resolveProject(client, input.project);
        projectId = project._id;
    }
    let statusIds;
    let statusMap;
    if (input.status) {
        const result = await resolveStatusIds(client, input.status);
        statusIds = result.ids;
        statusMap = result.statusMap;
    }
    else {
        statusMap = await getStatusMap(client);
    }
    const projectMap = await getProjectMap(client);
    const tasks = await client.queryTasks({
        assignee: assigneeId,
        projectId,
        statusIds,
        overdue: input.overdue,
        dueToday: input.dueToday,
    });
    return { tasks, projectMap, statusMap };
}
export function isCompletedStatus(statusName) {
    const lower = statusName.toLowerCase();
    return lower.includes('done') || lower.includes('closed') || lower.includes('completed') || lower.includes('resolved');
}
