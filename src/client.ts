import pkg from '@hcengineering/api-client';
const { connect } = pkg as any;
import { getApiKey, getHost, getWorkspaceId } from './utils/auth.js';

export interface TaskQueryOptions {
    assignee?: string;
    statusIds?: string[];
    projectId?: string;
    overdue?: boolean;
    dueToday?: boolean;
}

export interface CreateTaskOptions {
    title: string;
    projectId: string; // Space ID
    priority?: number;
    dueDate?: number; // timestamp
    assigneeId?: string; // Person ID
    statusId?: string; // Status ID
    description?: string;
    kindId?: string; // Task type / kind ref
    componentId?: string; // Component ref
    milestoneId?: string; // Milestone ref
    rawFields?: Record<string, any>; // custom/raw fields
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

export class HulyClient {
    private client: any = null;
    private _persons: any[] | null = null;
    private _projects: any[] | null = null;
    private _statuses: any[] | null = null;
    private _account: any | null = null;

    async connect() {
        this.client = await connect(getHost(), {
            token: getApiKey(),
            workspace: getWorkspaceId()
        });
        return this;
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }

    getRawClient() {
        return this.client;
    }

    async getAccount() {
        if (!this._account) this._account = await this.client.getAccount();
        return this._account;
    }

    async getPersons(): Promise<any[]> {
        if (!this._persons) this._persons = await this.client.findAll('contact:class:Person', {});
        return this._persons!;
    }

    async getProjects(): Promise<any[]> {
        if (!this._projects) this._projects = await this.client.findAll('tracker:class:Project', {});
        return this._projects!;
    }

    async getStatuses(): Promise<any[]> {
        if (this._statuses) return this._statuses;
        try {
            this._statuses = await this.client.findAll('tracker:class:IssueStatus', {}, { limit: 500 });
            return this._statuses!;
        } catch (e: any) {
            if (e.message?.includes('domain not found') || e.message?.includes('class not found')) {
                this._statuses = [];
                return this._statuses;
            }
            throw e;
        }
    }

    async getTask(taskId: string): Promise<any | null> {
        const issues = await this.client.findAll('tracker:class:Issue', { identifier: taskId });
        if (!issues || issues.length === 0) return null;
        return issues[0];
    }

    async queryTasks(options: TaskQueryOptions): Promise<any[]> {
        const query: any = {};

        if (options.assignee) {
            query.assignee = options.assignee;
        }

        if (options.projectId) {
            query.space = options.projectId;
        }

        if (options.overdue || options.dueToday) {
            query.dueDate = { $exists: true };
        }

        // Notice: The array $in might need to be evaluated on the client side if the API server doesn't support it fully.
        // However, the api-client translates it to standard Mongo queries.
        if (options.statusIds && options.statusIds.length > 0) {
            query.status = { $in: options.statusIds };
        }

        const issues = await this.client.findAll('tracker:class:Issue', query, {
            limit: 500,
            sort: { dueDate: 1 }
        });

        if (options.overdue || options.dueToday) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTime = today.getTime();

            return issues.filter((task: any) => {
                if (!task.dueDate) return false;

                const dueDate = new Date(task.dueDate);
                dueDate.setHours(0, 0, 0, 0);
                const dueTime = dueDate.getTime();

                if (options.overdue && dueTime < todayTime) {
                    // If filtering overdue, omit completed statuses.
                    // This should be done strictly, but we return the filtered dates here.
                    return true;
                }

                if (options.dueToday && dueTime === todayTime) {
                    return true;
                }

                return false;
            });
        }

        return issues;
    }

    async createTask(options: CreateTaskOptions): Promise<any> {
        const taskAttributes: any = {
            title: options.title,
        };

        if (options.priority !== undefined) taskAttributes.priority = options.priority;
        if (options.dueDate !== undefined) taskAttributes.dueDate = options.dueDate;
        if (options.assigneeId) taskAttributes.assignee = options.assigneeId;
        if (options.statusId) taskAttributes.status = options.statusId;
        if (options.description) taskAttributes.description = options.description;
        if (options.kindId) taskAttributes.kind = options.kindId;
        if (options.componentId) taskAttributes.component = options.componentId;
        if (options.milestoneId) taskAttributes.milestone = options.milestoneId;
        if (options.rawFields) Object.assign(taskAttributes, options.rawFields);

        const createdTaskId = await this.client.addCollection(
            'tracker:class:Issue',
            options.projectId, // space
            'tracker:ids:NoParent', // attachedTo
            'tracker:class:Issue', // attachedToClass
            'subIssues', // collection name
            taskAttributes
        );

        return await this.client.findOne('tracker:class:Issue', { _id: createdTaskId });
    }

    async updateTask(taskId: string, options: UpdateTaskOptions): Promise<any> {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        const updates: any = {};
        if (options.statusId !== undefined) updates.status = options.statusId;
        if (options.priority !== undefined) updates.priority = options.priority;
        if (options.dueDate !== undefined) updates.dueDate = options.dueDate;
        if (options.assigneeId !== undefined) updates.assignee = options.assigneeId;
        if (options.title !== undefined) updates.title = options.title;
        if (options.description !== undefined) updates.description = options.description;
        if (options.kindId !== undefined) updates.kind = options.kindId;
        if (options.componentId !== undefined) updates.component = options.componentId;
        if (options.milestoneId !== undefined) updates.milestone = options.milestoneId;
        if (options.rawFields) Object.assign(updates, options.rawFields);
        if (options.descriptionMarkdown !== undefined) {
            const uploaded = await this.client.uploadMarkup(
                'tracker:class:Issue',
                task._id,
                'description',
                options.descriptionMarkdown,
                'markdown'
            );
            updates.description = uploaded;
        }

        await this.client.updateDoc('tracker:class:Issue', task.space, task._id, updates, false);
        return await this.getTask(taskId);
    }

    async addComment(taskId: string, commentText: string): Promise<void> {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        // Creating comments might use addCollection as well
        await this.client.addCollection(
            'tracker:class:Comment',
            task.space,
            task._id,
            'tracker:class:Issue',
            'comments',
            { text: commentText }
        );
    }

    async fetchMarkup(objectClass: string, objectId: string, objectAttr: string, markup: string, format: string = 'markdown'): Promise<string> {
        return await this.client.fetchMarkup(objectClass, objectId, objectAttr, markup, format);
    }

    async deleteTask(taskId: string): Promise<void> {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        await this.client.removeDoc(
            'tracker:class:Issue',
            task.space,
            task._id
        );
    }
}

export async function withClient<T>(fn: (client: HulyClient) => Promise<T>): Promise<T> {
    const client = new HulyClient();
    try {
        await client.connect();
        return await fn(client);
    } finally {
        await client.disconnect();
    }
}
