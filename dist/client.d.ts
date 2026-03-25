type PlatformClient = any;
export interface TaskQueryOptions {
    assignee?: string;
    statusIds?: string[];
    projectId?: string;
    overdue?: boolean;
    dueToday?: boolean;
}
export interface CreateTaskOptions {
    title: string;
    projectId: string;
    priority?: number;
    dueDate?: number;
    assigneeId?: string;
    statusId?: string;
    description?: string;
    kindId?: string;
    componentId?: string;
    milestoneId?: string;
    rawFields?: Record<string, any>;
}
export interface UpdateTaskOptions {
    statusId?: string;
    priority?: number;
    dueDate?: number;
    assigneeId?: string;
    title?: string;
    description?: string;
    kindId?: string;
    componentId?: string | null;
    milestoneId?: string | null;
    descriptionMarkdown?: string;
    rawFields?: Record<string, any>;
}
export declare class HulyClient {
    private client;
    private _persons;
    private _projects;
    private _statuses;
    private _account;
    connect(): Promise<this>;
    disconnect(): Promise<void>;
    getRawClient(): PlatformClient;
    getAccount(): Promise<any>;
    getPersons(): Promise<any[]>;
    getProjects(): Promise<any[]>;
    getStatuses(): Promise<any[]>;
    getTask(taskId: string): Promise<any | null>;
    queryTasks(options: TaskQueryOptions): Promise<any[]>;
    /**
     * Create a task following the official Huly API pattern:
     * 1. Increment project sequence to get issue number
     * 2. Fetch last issue rank for ordering
     * 3. Upload markdown description if provided
     * 4. Create issue via addCollection with all required fields
     */
    createTask(options: CreateTaskOptions): Promise<any>;
    updateTask(taskId: string, options: UpdateTaskOptions): Promise<any>;
    addComment(taskId: string, commentText: string): Promise<void>;
    deleteTask(taskId: string): Promise<void>;
    createLabel(title: string, color?: number): Promise<any>;
    assignLabel(issueId: string, spaceId: string, labelId: string, title: string, color?: number): Promise<void>;
    getLabels(issueId: string): Promise<any[]>;
    getAllLabels(): Promise<any[]>;
    getTeamspaces(): Promise<any[]>;
    getDocuments(teamspaceId: string): Promise<any[]>;
    createDocument(teamspaceId: string, title: string, markdownContent: string): Promise<any>;
    getDocumentContent(doc: any): Promise<string | null>;
    createTeamspace(name: string, description?: string, isPrivate?: boolean): Promise<any>;
    getMilestones(projectId: string): Promise<any[]>;
    createMilestone(projectId: string, label: string, targetDate: number): Promise<any>;
    updateMilestone(projectId: string, milestoneId: string, updates: any): Promise<void>;
    createPerson(name: string, city?: string): Promise<any>;
    addPersonEmail(personId: string, email: string): Promise<void>;
    fetchMarkup(doc: any, field: string): Promise<string | null>;
}
export declare function withClient<T>(fn: (client: HulyClient) => Promise<T>): Promise<T>;
export {};
