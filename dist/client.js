import apiClient from '@hcengineering/api-client';
import coreModule from '@hcengineering/core';
// CJS interop: these packages use module.exports, named ESM imports don't work
const { connect, NodeWebSocketFactory, MarkupContent, markdown: markdownContent } = apiClient;
const { SortingOrder, generateId } = coreModule;
const core = coreModule;
import { getApiKey, getHost, getWorkspaceId } from './utils/auth.js';
import { tracker, contact, document as hulyDocument, tags, IssuePriority, MilestoneStatus, AvatarType, makeRank, } from './huly-types.js';
export class HulyClient {
    client = null;
    _persons = null;
    _projects = null;
    _statuses = null;
    _account = null;
    async connect() {
        const options = {
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
    getRawClient() {
        if (!this.client)
            throw new Error('Client not connected');
        return this.client;
    }
    async getAccount() {
        if (!this._account)
            this._account = await this.client.getAccount();
        return this._account;
    }
    async getPersons() {
        if (!this._persons) {
            this._persons = await this.client.findAll(contact.class.Person, {});
        }
        return this._persons;
    }
    async getProjects() {
        if (!this._projects) {
            this._projects = await this.client.findAll(tracker.class.Project, {});
        }
        return this._projects;
    }
    async getStatuses() {
        if (this._statuses)
            return this._statuses;
        try {
            this._statuses = await this.client.findAll(tracker.class.IssueStatus, {}, { limit: 500 });
            return this._statuses;
        }
        catch (e) {
            if (e.message?.includes('domain not found') || e.message?.includes('class not found')) {
                this._statuses = [];
                return this._statuses;
            }
            throw e;
        }
    }
    async getTask(taskId) {
        const issues = await this.client.findAll(tracker.class.Issue, { identifier: taskId });
        if (!issues || issues.length === 0)
            return null;
        return issues[0];
    }
    async queryTasks(options) {
        const query = {};
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
        const issues = await this.client.findAll(tracker.class.Issue, query, {
            limit: 500,
            sort: { dueDate: SortingOrder.Ascending },
        });
        if (options.overdue || options.dueToday) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTime = today.getTime();
            return issues.filter((task) => {
                if (!task.dueDate)
                    return false;
                const dueDate = new Date(task.dueDate);
                dueDate.setHours(0, 0, 0, 0);
                const dueTime = dueDate.getTime();
                if (options.overdue && dueTime < todayTime)
                    return true;
                if (options.dueToday && dueTime === todayTime)
                    return true;
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
    async createTask(options) {
        const project = await this.client.findOne(tracker.class.Project, { _id: options.projectId });
        if (!project) {
            throw new Error(`Project not found: ${options.projectId}`);
        }
        // Generate unique issue ID
        const issueId = generateId();
        // Increment project sequence to get next issue number
        const incResult = await this.client.updateDoc(tracker.class.Project, core.space.Space, project._id, { $inc: { sequence: 1 } }, true);
        const sequence = incResult.object.sequence;
        // Fetch rank of the last issue for ordering
        const lastOne = await this.client.findOne(tracker.class.Issue, { space: project._id }, { sort: { rank: SortingOrder.Descending } });
        // Upload markdown description if provided
        let description = '';
        if (options.description) {
            description = await this.client.uploadMarkup(tracker.class.Issue, issueId, 'description', options.description, 'markdown');
        }
        // Build task attributes with all required fields (official pattern)
        const taskAttributes = {
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
        if (options.rawFields)
            Object.assign(taskAttributes, options.rawFields);
        // Create issue via addCollection (official pattern: attach to project)
        const c = this.client;
        await c.addCollection(tracker.class.Issue, project._id, // space
        project._id, // attachedTo (project)
        project._class, // attachedToClass
        'issues', // collection name
        taskAttributes, issueId);
        return await this.client.findOne(tracker.class.Issue, { _id: issueId });
    }
    async updateTask(taskId, options) {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        const updates = {};
        if (options.statusId !== undefined)
            updates.status = options.statusId;
        if (options.priority !== undefined)
            updates.priority = options.priority;
        if (options.dueDate !== undefined)
            updates.dueDate = options.dueDate;
        if (options.assigneeId !== undefined)
            updates.assignee = options.assigneeId;
        if (options.title !== undefined)
            updates.title = options.title;
        if (options.description !== undefined)
            updates.description = options.description;
        if (options.kindId !== undefined)
            updates.kind = options.kindId;
        if (options.componentId !== undefined)
            updates.component = options.componentId;
        if (options.milestoneId !== undefined)
            updates.milestone = options.milestoneId;
        if (options.rawFields)
            Object.assign(updates, options.rawFields);
        if (options.descriptionMarkdown !== undefined) {
            // Use MarkupContent so SDK's processMarkup handles upload+update atomically
            updates.description = new MarkupContent(options.descriptionMarkdown, 'markdown');
        }
        await this.client.updateDoc(tracker.class.Issue, task.space, task._id, updates, false);
        return await this.getTask(taskId);
    }
    async addComment(taskId, commentText) {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        await this.client.addCollection('chunter:class:ChatMessage', task.space, task._id, tracker.class.Issue, 'comments', { message: commentText });
    }
    async deleteTask(taskId) {
        const task = await this.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        await this.client.removeDoc(tracker.class.Issue, task.space, task._id);
    }
    // -----------------------------------------------------------------------
    // Labels / Tags
    // -----------------------------------------------------------------------
    async createLabel(title, color = 11) {
        const labelId = generateId();
        await this.client.createDoc(tags.class.TagElement, core.space.Workspace, {
            title,
            description: '',
            targetClass: tracker.class.Issue,
            color,
            category: tracker.category.Other,
        }, labelId);
        return await this.client.findOne(tags.class.TagElement, { _id: labelId });
    }
    async assignLabel(issueId, spaceId, labelId, title, color = 11) {
        await this.client.addCollection(tags.class.TagReference, spaceId, issueId, tracker.class.Issue, 'labels', { title, color, tag: labelId });
    }
    async getLabels(issueId) {
        return await this.client.findAll(tags.class.TagReference, {
            attachedTo: issueId,
            attachedToClass: tracker.class.Issue,
        });
    }
    async getAllLabels() {
        return await this.client.findAll(tags.class.TagElement, { targetClass: tracker.class.Issue });
    }
    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    async getTeamspaces() {
        return await this.client.findAll(hulyDocument.class.Teamspace, { archived: false });
    }
    async getDocuments(teamspaceId) {
        return await this.client.findAll(hulyDocument.class.Document, { space: teamspaceId }, {
            limit: 100,
            sort: { name: SortingOrder.Ascending },
        });
    }
    async createDocument(teamspaceId, title, markdownContent) {
        const lastOne = await this.client.findOne(hulyDocument.class.Document, { space: teamspaceId }, { sort: { rank: SortingOrder.Descending } });
        const documentId = generateId();
        const content = await this.client.uploadMarkup(hulyDocument.class.Document, documentId, 'content', markdownContent, 'markdown');
        await this.client.createDoc(hulyDocument.class.Document, teamspaceId, {
            title,
            content,
            parent: hulyDocument.ids.NoParent,
            rank: makeRank(lastOne?.rank, undefined),
        }, documentId);
        return await this.client.findOne(hulyDocument.class.Document, { _id: documentId });
    }
    async getDocumentContent(doc) {
        if (!doc.content)
            return null;
        return await this.client.fetchMarkup(doc._class, doc._id, 'content', doc.content, 'markdown');
    }
    async createTeamspace(name, description = '', isPrivate = false) {
        const account = await this.getAccount();
        const teamspaceId = await this.client.createDoc(hulyDocument.class.Teamspace, core.space.Space, {
            name,
            description,
            private: isPrivate,
            archived: false,
            members: [account._id],
            owners: [account._id],
            icon: hulyDocument.icon.Teamspace,
            type: hulyDocument.spaceType.DefaultTeamspaceType,
        });
        return await this.client.findOne(hulyDocument.class.Teamspace, { _id: teamspaceId });
    }
    // -----------------------------------------------------------------------
    // Milestones
    // -----------------------------------------------------------------------
    async getMilestones(projectId) {
        return await this.client.findAll(tracker.class.Milestone, { space: projectId });
    }
    async createMilestone(projectId, label, targetDate) {
        const milestoneId = generateId();
        await this.client.createDoc(tracker.class.Milestone, projectId, {
            label,
            status: MilestoneStatus.InProgress,
            targetDate,
            comments: 0,
        }, milestoneId);
        return await this.client.findOne(tracker.class.Milestone, { _id: milestoneId });
    }
    async updateMilestone(projectId, milestoneId, updates) {
        await this.client.updateDoc(tracker.class.Milestone, projectId, milestoneId, updates, false);
    }
    // -----------------------------------------------------------------------
    // Persons / Contacts
    // -----------------------------------------------------------------------
    async createPerson(name, city) {
        const personId = generateId();
        await this.client.createDoc(contact.class.Person, contact.space.Contacts, {
            name,
            city: city || '',
            avatarType: AvatarType.COLOR,
        }, personId);
        return await this.client.findOne(contact.class.Person, { _id: personId });
    }
    async addPersonEmail(personId, email) {
        await this.client.addCollection(contact.class.Channel, contact.space.Contacts, personId, contact.class.Person, 'channels', {
            provider: contact.channelProvider.Email,
            value: email,
        });
    }
    // -----------------------------------------------------------------------
    // Markup helpers
    // -----------------------------------------------------------------------
    async fetchMarkup(doc, field) {
        if (!doc[field])
            return null;
        return await this.client.fetchMarkup(doc._class, doc._id, field, doc[field], 'markdown');
    }
}
export async function withClient(fn) {
    const client = new HulyClient();
    try {
        await client.connect();
        return await fn(client);
    }
    finally {
        await client.disconnect();
    }
}
