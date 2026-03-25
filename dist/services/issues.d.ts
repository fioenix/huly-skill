import { HulyClient } from '../client.js';
export interface CreateIssueInput {
    title: string;
    project: string;
    priority?: string;
    due?: string;
    assignee?: string;
    description?: string;
    kindId?: string;
    componentId?: string;
    milestoneId?: string;
    rawFields?: Record<string, any>;
}
export interface UpdateIssueInput {
    status?: string;
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
    status?: string;
    overdue?: boolean;
    dueToday?: boolean;
}
export interface IssueResult {
    task: any;
    projectIdentifier: string;
    projectName: string;
    assigneeName: string;
}
export declare function createIssue(client: HulyClient, input: CreateIssueInput): Promise<IssueResult>;
export declare function updateIssue(client: HulyClient, taskId: string, input: UpdateIssueInput): Promise<string[]>;
export interface QueryResult {
    tasks: any[];
    projectMap: Map<string, any>;
    statusMap: Map<string, any>;
}
export declare function queryIssues(client: HulyClient, input: QueryIssuesInput): Promise<QueryResult>;
export declare function isCompletedStatus(statusName: string): boolean;
