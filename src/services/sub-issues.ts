import { HulyClient } from '../client.js';
import { getProjectMap, getStatusMap } from '../resolvers.js';
import { isCompletedStatus } from './issues.js';

export interface SubIssueNode {
    identifier: string;
    internalId: string;
    title: string;
    status: string;
    statusId: string;
    assignee: string | null;
    assigneeId: string | null;
    priority: number;
    estimation: number;
    reportedTime: number;
    remainingTime: number;
    dueDate: number | null;
    milestone: string | null;
    component: string | null;
    level: number;
    parentIdentifier: string;
    childCount: number;
    children: SubIssueNode[];
}

export interface SubIssueTreeResult {
    parent: string;
    parentInternalId: string;
    totalCount: number;
    directChildren: number;
    data: SubIssueNode[];
    flat: Omit<SubIssueNode, 'children'>[];
}

interface BuildContext {
    statusMap: Map<string, any>;
    personMap: Map<string, any>;
}

/**
 * Build a sub-issue tree for `taskIdentifier`.
 *
 * Implementation note: we walk via `attachedTo` rather than `childInfo[].childId`.
 * Both reference the same set of issues but `attachedTo` is queryable directly,
 * which means one `findAll` per level instead of N `findOne` per child.
 *
 * The optional non-recursive mode is the cheapest path: a single round-trip
 * for the direct children only.
 */
export async function getSubIssueTree(
    client: HulyClient,
    taskIdentifier: string,
    recursive: boolean = true,
): Promise<SubIssueTreeResult> {
    const parent = await client.getTask(taskIdentifier);
    if (!parent) throw new Error(`Task not found: ${taskIdentifier}`);

    const statusMap = await getStatusMap(client);
    const persons = await client.getPersons();
    const personMap = new Map<string, any>();
    for (const p of persons) personMap.set(p._id, p);

    const ctx: BuildContext = { statusMap, personMap };
    const flat: Omit<SubIssueNode, 'children'>[] = [];

    const tree = await walk(client, parent._id, parent.identifier, 1, recursive, ctx, flat);

    return {
        parent: parent.identifier,
        parentInternalId: parent._id,
        totalCount: flat.length,
        directChildren: tree.length,
        data: tree,
        flat,
    };
}

async function walk(
    client: HulyClient,
    parentInternalId: string,
    parentIdentifier: string,
    level: number,
    recursive: boolean,
    ctx: BuildContext,
    flat: Omit<SubIssueNode, 'children'>[],
): Promise<SubIssueNode[]> {
    const children = await client.findSubIssues(parentInternalId);
    const nodes: SubIssueNode[] = [];

    for (const child of children) {
        const statusName = ctx.statusMap.get(child.status)?.name || 'Unknown';
        const assignee = child.assignee ? ctx.personMap.get(child.assignee) : null;
        const childCount = Array.isArray(child.childInfo) ? child.childInfo.length : 0;

        const flatNode: Omit<SubIssueNode, 'children'> = {
            identifier: child.identifier,
            internalId: child._id,
            title: child.title,
            status: statusName,
            statusId: child.status,
            assignee: assignee?.name ?? null,
            assigneeId: child.assignee ?? null,
            priority: child.priority ?? 0,
            estimation: child.estimation ?? 0,
            reportedTime: child.reportedTime ?? 0,
            remainingTime: child.remainingTime ?? 0,
            dueDate: child.dueDate ?? null,
            milestone: child.milestone ?? null,
            component: child.component ?? null,
            level,
            parentIdentifier,
            childCount,
        };
        flat.push(flatNode);

        const grandChildren = recursive && childCount > 0
            ? await walk(client, child._id, child.identifier, level + 1, true, ctx, flat)
            : [];

        nodes.push({ ...flatNode, children: grandChildren });
    }

    return nodes;
}

// ---------------------------------------------------------------------------
// Milestone report
// ---------------------------------------------------------------------------

export interface MilestoneReportEpic {
    identifier: string;
    title: string;
    status: string;
    assignee: string | null;
    estimation: number;
    reportedTime: number;
    childCount: number;
    children: SubIssueNode[];
    completedCount: number;
}

export interface MilestoneReportResult {
    milestoneId: string;
    milestoneLabel: string;
    project: string;
    totalIssues: number;
    epics: MilestoneReportEpic[];
    orphans: Omit<SubIssueNode, 'children'>[];
    summary: {
        totalEstimation: number;
        totalReported: number;
        completedCount: number;
        inProgressCount: number;
    };
}

/**
 * Build a milestone report grouped by Epic (top-level issues).
 *
 * `milestoneId` is the internal milestone _id; resolving by name is left to
 * callers since milestone names are not unique across projects.
 *
 * "Epic" here means: any issue in the milestone whose `attachedTo === space`
 * (attached to the project, not to another issue). Everything else is a
 * sub-issue and is folded into its epic's tree if reachable, otherwise it's
 * surfaced as an orphan (parent outside this milestone).
 */
export async function getMilestoneReport(
    client: HulyClient,
    milestoneId: string,
): Promise<MilestoneReportResult> {
    const projectMap = await getProjectMap(client);
    const statusMap = await getStatusMap(client);
    const persons = await client.getPersons();
    const personMap = new Map<string, any>();
    for (const p of persons) personMap.set(p._id, p);

    // Find the milestone record (search across projects since milestoneId is global).
    let milestoneRecord: any = null;
    let projectIdentifier = '';
    for (const project of projectMap.values()) {
        const milestones = await client.getMilestones(project._id);
        const found = milestones.find((m: any) => m._id === milestoneId);
        if (found) {
            milestoneRecord = found;
            projectIdentifier = project.identifier || project.name || project._id;
            break;
        }
    }

    const milestoneLabel = milestoneRecord?.label || milestoneId;

    const issues = await client.queryTasks({ milestoneId });

    const issueById = new Map<string, any>();
    for (const i of issues) issueById.set(i._id, i);

    const epics: MilestoneReportEpic[] = [];
    const orphans: Omit<SubIssueNode, 'children'>[] = [];

    let totalEst = 0;
    let totalRep = 0;
    let completed = 0;
    let inProgress = 0;

    for (const issue of issues) {
        const statusName = statusMap.get(issue.status)?.name || 'Unknown';
        totalEst += issue.estimation ?? 0;
        totalRep += issue.reportedTime ?? 0;
        if (isCompletedStatus(statusName)) completed++;
        else if (statusName.toLowerCase().includes('progress')) inProgress++;
    }

    const isEpic = (issue: any): boolean => issue.attachedTo === issue.space;

    for (const issue of issues) {
        if (!isEpic(issue)) continue;

        const ctx: BuildContext = { statusMap, personMap };
        const flat: Omit<SubIssueNode, 'children'>[] = [];
        const children = await walk(client, issue._id, issue.identifier, 1, true, ctx, flat);

        const completedInEpic = flat.filter((n) =>
            isCompletedStatus(n.status),
        ).length;

        const statusName = statusMap.get(issue.status)?.name || 'Unknown';
        const assignee = issue.assignee ? personMap.get(issue.assignee) : null;

        epics.push({
            identifier: issue.identifier,
            title: issue.title,
            status: statusName,
            assignee: assignee?.name ?? null,
            estimation: issue.estimation ?? 0,
            reportedTime: issue.reportedTime ?? 0,
            childCount: flat.length,
            children,
            completedCount: completedInEpic,
        });
    }

    // Orphans: issues in the milestone whose parent is not reachable within
    // the same milestone (e.g. epic lives in a different milestone).
    for (const issue of issues) {
        if (isEpic(issue)) continue;
        if (issueById.has(issue.attachedTo)) continue;

        const statusName = statusMap.get(issue.status)?.name || 'Unknown';
        const assignee = issue.assignee ? personMap.get(issue.assignee) : null;
        orphans.push({
            identifier: issue.identifier,
            internalId: issue._id,
            title: issue.title,
            status: statusName,
            statusId: issue.status,
            assignee: assignee?.name ?? null,
            assigneeId: issue.assignee ?? null,
            priority: issue.priority ?? 0,
            estimation: issue.estimation ?? 0,
            reportedTime: issue.reportedTime ?? 0,
            remainingTime: issue.remainingTime ?? 0,
            dueDate: issue.dueDate ?? null,
            milestone: issue.milestone ?? null,
            component: issue.component ?? null,
            level: 1,
            parentIdentifier: '(external)',
            childCount: Array.isArray(issue.childInfo) ? issue.childInfo.length : 0,
        });
    }

    return {
        milestoneId,
        milestoneLabel,
        project: projectIdentifier,
        totalIssues: issues.length,
        epics,
        orphans,
        summary: {
            totalEstimation: totalEst,
            totalReported: totalRep,
            completedCount: completed,
            inProgressCount: inProgress,
        },
    };
}
