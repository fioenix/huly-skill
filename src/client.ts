import pkg from '@hcengineering/api-client';
const { connect } = pkg;
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
}

export interface UpdateTaskOptions {
    statusId?: string;
    priority?: number;
    dueDate?: number;
    assigneeId?: string;
    title?: string;
    description?: string;
}

export class HulyClient {
    private client: any = null;

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
        return await this.client.getAccount();
    }

    async getPersons(): Promise<any[]> {
        return await this.client.findAll('contact:class:Person', {});
    }

    async getProjects(): Promise<any[]> {
        return await this.client.findAll('tracker:class:Project', {});
    }

    async getStatuses(): Promise<any[]> {
        // Some statuses are attached to spaces, some are global. We'll fetch a bunch.
        try {
            return await this.client.findAll('tracker:class:Status', {}, { limit: 500 });
        } catch (e: any) {
            // "domain not found" error means we can't fetch statuses globally like this on this version
            return [];
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
        // Find next identifier
        const existingIssues = await this.client.findAll('tracker:class:Issue', {
            space: options.projectId
        }, { limit: 100 });

        let maxNum = 0;
        const projectMatch = options.projectId; // Will use project abbreviation next step

        // We need to fetch the project to know its identifier (e.g., DELTA)
        const projects = await this.client.findAll('tracker:class:Project', { _id: options.projectId });
        const projectIdentifier = projects && projects.length > 0 ? projects[0].identifier : 'TASK';

        for (const issue of existingIssues) {
            if (issue.identifier) {
                const match = issue.identifier.match(new RegExp(`${projectIdentifier}-(\\d+)`));
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
        }
        const nextNum = maxNum + 1;
        const identifier = `${projectIdentifier}-${nextNum}`;

        const taskAttributes: any = {
            title: options.title,
            identifier: identifier
        };

        if (options.priority !== undefined) taskAttributes.priority = options.priority;
        if (options.dueDate !== undefined) taskAttributes.dueDate = options.dueDate;
        if (options.assigneeId) taskAttributes.assignee = options.assigneeId;
        if (options.statusId) taskAttributes.status = options.statusId;
        if (options.description) taskAttributes.description = options.description;

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

        await this.client.update('tracker:class:Issue', task._id, updates);
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
