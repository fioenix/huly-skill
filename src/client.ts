import apiClient from '@hcengineering/api-client';
import coreModule from '@hcengineering/core';

// CJS interop: these packages use module.exports, named ESM imports don't work
const { connect, NodeWebSocketFactory, MarkupContent, markdown: markdownContent } = apiClient as any;
const { SortingOrder, generateId } = coreModule as any;
const core = coreModule as any;

type ConnectOptions = any;
type PlatformClient = any;
type Ref<T> = string & { __ref: T };
type Doc = any;
import { getApiKey, getHost, getWorkspaceId } from './utils/auth.js';
import {
    tracker, contact, document as hulyDocument, tags,
    IssuePriority, MilestoneStatus, AvatarType,
    makeRank,
} from './huly-types.js';

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
    description?: string; // markdown content
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
    private client: PlatformClient | null = null;
    private _persons: any[] | null = null;
    private _projects: any[] | null = null;
    private _statuses: any[] | null = null;
    private _account: any | null = null;

    async connect() {
        const options: ConnectOptions = {
            token: getApiKey(),
            workspace: getWorkspaceId(),
            socketFactory: NodeWebSocketFactory,
            connectionTimeout: 30000,
        };
        this.client = await connect(getHost(), options);
        return this;
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }

    getRawClient(): PlatformClient {
        if (!this.client) throw new Error('Client not connected');
        return this.client;
    }

    async getAccount() {
        if (!this._account) this._account = await this.client!.getAccount();
        return this._account;
    }

    async getPersons(): Promise<any[]> {
        if (!this._persons) {
            this._persons = await this.client!.findAll(contact.class.Person as any, {});
        }
        return this._persons!;
    }

    async getProjects(): Promise<any[]> {
        if (!this._projects) {
            this._projects = await this.client!.findAll(tracker.class.Project as any, {});
        }
        return this._projects!;
    }

    async getStatuses(): Promise<any[]> {
        if (this._statuses) return this._statuses;
        try {
            this._statuses = await this.client!.findAll(
                tracker.class.IssueStatus as any, {}, { limit: 500 }
            );
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
        const issues = await this.client!.findAll(
            tracker.class.Issue as any,
            { identifier: taskId }
        );
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

        if (options.statusIds && options.statusIds.length > 0) {
            query.status = { $in: options.statusIds };
        }

        const issues = await this.client!.findAll(
            tracker.class.Issue as any,
            query,
            {
                limit: 500,
                sort: { dueDate: SortingOrder.Ascending },
            }
        );

        if (options.overdue || options.dueToday) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTime = today.getTime();

            return issues.filter((task: any) => {
                if (!task.dueDate) return false;

                const dueDate = new Date(task.dueDate);
                dueDate.setHours(0, 0, 0, 0);
                const dueTime = dueDate.getTime();

                if (options.overdue && dueTime < todayTime) return true;
                if (options.dueToday && dueTime === todayTime) return true;

                return false;
            });
        }

        return issues;
    }

    /**
     * Create a task following the official Huly API pattern:
     * 1. Increment project sequence to get issue number
     * 2. Fetch last issue rank for ordering
     * 3. Upload markdown description if provided
     * 4. Create issue via addCollection with all required fields
     */
    async createTask(options: CreateTaskOptions): Promise<any> {
        const project: any = await this.client!.findOne(
            tracker.class.Project as any,
            { _id: options.projectId } as any
        );
        if (!project) {
            throw new Error(`Project not found: ${options.projectId}`);
        }

        // Generate unique issue ID
        const issueId: Ref<Doc> = generateId();

        // Increment project sequence to get next issue number
        const incResult = await this.client!.updateDoc(
            tracker.class.Project as any,
            core.space.Space as any,
            project._id,
            { $inc: { sequence: 1 } } as any,
            true
        );
        const sequence = (incResult as any).object.sequence;

        // Fetch rank of the last issue for ordering
        const lastOne: any = await this.client!.findOne(
            tracker.class.Issue as any,
            { space: project._id } as any,
            { sort: { rank: SortingOrder.Descending } }
        );

        // Upload markdown description if provided
        let description: any = '';
        if (options.description) {
            description = await (this.client as any).uploadMarkup(
                tracker.class.Issue,
                issueId,
                'description',
                options.description,
                'markdown'
            );
        }

        // Build task attributes with all required fields (official pattern)
        const taskAttributes: any = {
            title: options.title,
            description,
            status: options.statusId || project.defaultIssueStatus,
            number: sequence,
            kind: options.kindId || tracker.taskTypes.Issue,
            identifier: `${project.identifier}-${sequence}`,
            priority: options.priority ?? IssuePriority.Medium,
            assignee: options.assigneeId || null,
            component: options.componentId || null,
            milestone: options.milestoneId || null,
            estimation: 0,
            remainingTime: 0,
            reportedTime: 0,
            reports: 0,
            subIssues: 0,
            parents: [],
            childInfo: [],
            dueDate: options.dueDate || null,
            rank: makeRank(lastOne?.rank, undefined),
        };

        // Apply custom raw fields
        if (options.rawFields) Object.assign(taskAttributes, options.rawFields);

        // Create issue via addCollection (official pattern: attach to project)
        const c = this.client as any;
        await c.addCollection(
            tracker.class.Issue,
            project._id,       // space
            project._id,       // attachedTo (project)
            project._class,    // attachedToClass
            'issues',          // collection name
            taskAttributes,
            issueId
        );

        return await this.client!.findOne(tracker.class.Issue as any, { _id: issueId } as any);
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
            // Use MarkupContent so SDK's processMarkup handles upload+update atomically
            updates.description = new MarkupContent(options.descriptionMarkdown, 'markdown');
        }

        await this.client!.updateDoc(
            tracker.class.Issue as any,
            task.space,
            task._id,
            updates,
            false
        );
        return await this.getTask(taskId);
    }

    async addComment(taskId: string, commentText: string): Promise<void> {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        await this.client!.addCollection(
            'chunter:class:ChatMessage' as any,
            task.space,
            task._id,
            tracker.class.Issue as any,
            'comments',
            { message: commentText } as any
        );
    }

    async deleteTask(taskId: string): Promise<void> {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        await this.client!.removeDoc(
            tracker.class.Issue as any,
            task.space,
            task._id
        );
    }

    // -----------------------------------------------------------------------
    // Labels / Tags
    // -----------------------------------------------------------------------

    async createLabel(title: string, color: number = 11): Promise<any> {
        const labelId: Ref<Doc> = generateId();
        await this.client!.createDoc(
            tags.class.TagElement as any,
            core.space.Workspace as any,
            {
                title,
                description: '',
                targetClass: tracker.class.Issue,
                color,
                category: tracker.category.Other,
            } as any,
            labelId
        );
        return await this.client!.findOne(tags.class.TagElement as any, { _id: labelId });
    }

    async assignLabel(issueId: string, spaceId: string, labelId: string, title: string, color: number = 11): Promise<void> {
        await this.client!.addCollection(
            tags.class.TagReference as any,
            spaceId as any,
            issueId as any,
            tracker.class.Issue as any,
            'labels',
            { title, color, tag: labelId } as any
        );
    }

    async getLabels(issueId: string): Promise<any[]> {
        return await this.client!.findAll(
            tags.class.TagReference as any,
            {
                attachedTo: issueId,
                attachedToClass: tracker.class.Issue,
            } as any
        );
    }

    async getAllLabels(): Promise<any[]> {
        return await this.client!.findAll(
            tags.class.TagElement as any,
            { targetClass: tracker.class.Issue } as any
        );
    }

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------

    async getTeamspaces(): Promise<any[]> {
        return await this.client!.findAll(
            hulyDocument.class.Teamspace as any,
            { archived: false } as any
        );
    }

    async getDocuments(teamspaceId: string): Promise<any[]> {
        return await this.client!.findAll(
            hulyDocument.class.Document as any,
            { space: teamspaceId } as any,
            {
                limit: 100,
                sort: { name: SortingOrder.Ascending },
            }
        );
    }

    async createDocument(teamspaceId: string, title: string, markdownContent: string): Promise<any> {
        const lastOne = await this.client!.findOne(
            hulyDocument.class.Document as any,
            { space: teamspaceId } as any,
            { sort: { rank: SortingOrder.Descending } }
        );

        const documentId: Ref<Doc> = generateId();
        const content = await (this.client as any).uploadMarkup(
            hulyDocument.class.Document,
            documentId,
            'content',
            markdownContent,
            'markdown'
        );

        await this.client!.createDoc(
            hulyDocument.class.Document as any,
            teamspaceId as any,
            {
                title,
                content,
                parent: hulyDocument.ids.NoParent,
                rank: makeRank((lastOne as any)?.rank, undefined),
            } as any,
            documentId
        );

        return await this.client!.findOne(hulyDocument.class.Document as any, { _id: documentId });
    }

    async getDocumentContent(doc: any): Promise<string | null> {
        if (!doc.content) return null;
        return await (this.client as any).fetchMarkup(
            doc._class, doc._id, 'content', doc.content, 'markdown'
        );
    }

    async createTeamspace(name: string, description: string = '', isPrivate: boolean = false): Promise<any> {
        const account = await this.getAccount();
        const teamspaceId = await this.client!.createDoc(
            hulyDocument.class.Teamspace as any,
            core.space.Space as any,
            {
                name,
                description,
                private: isPrivate,
                archived: false,
                members: [account._id],
                owners: [account._id],
                icon: hulyDocument.icon.Teamspace,
                type: hulyDocument.spaceType.DefaultTeamspaceType,
            } as any
        );
        return await this.client!.findOne(hulyDocument.class.Teamspace as any, { _id: teamspaceId });
    }

    // -----------------------------------------------------------------------
    // Milestones
    // -----------------------------------------------------------------------

    async getMilestones(projectId: string): Promise<any[]> {
        return await this.client!.findAll(
            tracker.class.Milestone as any,
            { space: projectId } as any
        );
    }

    async createMilestone(projectId: string, label: string, targetDate: number): Promise<any> {
        const milestoneId: Ref<Doc> = generateId();
        await this.client!.createDoc(
            tracker.class.Milestone as any,
            projectId as any,
            {
                label,
                status: MilestoneStatus.InProgress,
                targetDate,
                comments: 0,
            } as any,
            milestoneId
        );
        return await this.client!.findOne(tracker.class.Milestone as any, { _id: milestoneId });
    }

    async updateMilestone(projectId: string, milestoneId: string, updates: any): Promise<void> {
        await this.client!.updateDoc(
            tracker.class.Milestone as any,
            projectId as any,
            milestoneId as any,
            updates,
            false
        );
    }

    // -----------------------------------------------------------------------
    // Persons / Contacts
    // -----------------------------------------------------------------------

    async createPerson(name: string, city?: string): Promise<any> {
        const personId: Ref<Doc> = generateId();
        await this.client!.createDoc(
            contact.class.Person as any,
            contact.space.Contacts as any,
            {
                name,
                city: city || '',
                avatarType: AvatarType.COLOR,
            } as any,
            personId
        );
        return await this.client!.findOne(contact.class.Person as any, { _id: personId });
    }

    async addPersonEmail(personId: string, email: string): Promise<void> {
        await this.client!.addCollection(
            contact.class.Channel as any,
            contact.space.Contacts as any,
            personId as any,
            contact.class.Person as any,
            'channels',
            {
                provider: contact.channelProvider.Email,
                value: email,
            } as any
        );
    }

    // -----------------------------------------------------------------------
    // Markup helpers
    // -----------------------------------------------------------------------

    async fetchMarkup(doc: any, field: string): Promise<string | null> {
        if (!doc[field]) return null;
        return await (this.client as any).fetchMarkup(
            doc._class, doc._id, field, doc[field], 'markdown'
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
