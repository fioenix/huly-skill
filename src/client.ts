import apiClient from '@hcengineering/api-client';
import coreModule from '@hcengineering/core';
import textModule from '@hcengineering/text';
import textMarkdownModule from '@hcengineering/text-markdown';
/* eslint-disable @typescript-eslint/no-var-requires */
const WS = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

// CJS interop: these packages use module.exports, named ESM imports don't work
const { connect, NodeWebSocketFactory } = apiClient as any;

/**
 * Proxy-aware WebSocket factory. Replaces NodeWebSocketFactory when
 * HTTPS_PROXY is set (e.g. Claude Cowork sandbox at 127.0.0.1:3128).
 * When no proxy, falls back to default NodeWebSocketFactory.
 */
function createSocketFactory() {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (!proxyUrl) return NodeWebSocketFactory;

    const agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });

    return (url: string) => {
        process.stderr.write(`[huly-ws] connecting: ${url} via proxy ${proxyUrl}\n`);
        const ws = new WS(url, { agent, rejectUnauthorized: false });
        const client: any = {
            get readyState() { return ws.readyState; },
            send(data: any) {
                if (data instanceof Blob) {
                    void data.arrayBuffer().then((buffer: ArrayBuffer) => ws.send(buffer));
                } else {
                    ws.send(data);
                }
            },
            close(code?: number) { ws.close(code); },
        };
        ws.on('message', (data: any) => {
            client.onmessage?.({ data, type: 'message', target: undefined });
        });
        ws.on('close', (code: number, reason: string) => {
            process.stderr.write(`[huly-ws] closed: code=${code} reason=${reason}\n`);
            client.onclose?.({ code, reason, wasClean: code === 1000, type: 'close', target: undefined });
        });
        ws.on('open', () => {
            process.stderr.write(`[huly-ws] connected!\n`);
            client.onopen?.({ type: 'open', target: undefined });
        });
        ws.on('error', (error: any) => {
            process.stderr.write(`[huly-ws] error: ${error.message || error}\n`);
            client.onerror?.({ type: 'error', target: undefined, error });
        });
        ws.on('unexpected-response', (_req: any, res: any) => {
            process.stderr.write(`[huly-ws] unexpected-response: status=${res.statusCode}\n`);
        });
        return client;
    };
}
const { SortingOrder, generateId, makeCollabId } = coreModule as any;
// CJS interop: the `core` plugin object (with .space, .class) lives on the
// default export, while generateId/SortingOrder are top-level named exports.
// Without `.default`, core.space is undefined → write paths throw
// "Cannot read properties of undefined (reading 'Workspace'/'Space')".
const core = ((coreModule as any).default ?? coreModule) as any;
const { jsonToMarkup, markupToJSON } = textModule as any;
const { markdownToMarkup, markupToMarkdown } = textMarkdownModule as any;

type ConnectOptions = any;
type PlatformClient = any;
type Ref<T> = string & { __ref: T };
type Doc = any;
import { getApiKey, getHost, getWorkspaceId } from './utils/auth.js';
import {
    tracker, contact, document as hulyDocument, tags,
    activity, chunter, task,
    IssuePriority, MilestoneStatus, AvatarType,
    makeRank,
} from './huly-types.js';

export interface TaskQueryOptions {
    assignee?: string;
    statusIds?: string[];
    projectId?: string;
    overdue?: boolean;
    dueToday?: boolean;
    parentInternalId?: string;
    milestoneId?: string;
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
    parentId?: string; // Parent issue _id — creates the task as its sub-issue
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
    private _socialIds: any[] | null = null;
    private _projects: any[] | null = null;
    private _statuses: any[] | null = null;
    private _account: any | null = null;

    async connect() {
        const options: ConnectOptions = {
            token: getApiKey(),
            workspace: getWorkspaceId(),
            socketFactory: createSocketFactory(),
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

    /**
     * Social identities (contact:class:SocialIdentity). A doc's `modifiedBy`
     * is a SocialIdentity `_id`, not a Person `_id` — resolve actor names by
     * mapping `socialId._id → attachedTo (Person)`.
     */
    /**
     * Workspace people, flattened for listing: the Employee mixin carries
     * membership status and role, so surface those alongside the name.
     * Email lives on SocialIdentity and is deliberately left out — picking an
     * assignee only needs `_id`.
     */
    async getUsers(): Promise<Array<{ _id: string; name: string; active: boolean | null; role: string | null }>> {
        const persons = await this.getPersons();
        return persons.map((p: any) => {
            const employee = p[contact.mixin.Employee];
            return {
                _id: p._id,
                name: p.name || '',
                active: employee ? employee.active === true : null,
                role: employee?.role ?? null,
            };
        });
    }

    async getSocialIdentities(): Promise<any[]> {
        if (!this._socialIds) {
            this._socialIds = await this.client!.findAll(contact.class.SocialIdentity as any, {});
        }
        return this._socialIds!;
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

    /**
     * Fetch an issue by its internal Mongo-style `_id`. Used when we already
     * hold an internal id (e.g. from another issue's `childInfo[].childId`)
     * and want to skip the identifier→_id round-trip.
     */
    async getTaskByInternalId(internalId: string): Promise<any | null> {
        const issue = await this.client!.findOne(
            tracker.class.Issue as any,
            { _id: internalId } as any
        );
        return issue || null;
    }

    /**
     * Batch-resolve a set of internal ids in one round-trip.
     * Used by the sub-issue tree builder to avoid N findOne calls when
     * walking `childInfo[].childId`.
     */
    async findIssuesByInternalIds(internalIds: string[]): Promise<any[]> {
        if (!internalIds || internalIds.length === 0) return [];
        return await this.client!.findAll(
            tracker.class.Issue as any,
            { _id: { $in: internalIds } } as any,
            { limit: internalIds.length }
        );
    }

    /**
     * List direct sub-issues of a parent by its internal `_id`.
     * Mirrors how Huly's tracker stores nested issues (`attachedTo` points
     * at the parent issue, `collection` is the `subIssues` collection).
     */
    async findSubIssues(parentInternalId: string): Promise<any[]> {
        return await this.client!.findAll(
            tracker.class.Issue as any,
            { attachedTo: parentInternalId, collection: 'subIssues' } as any,
            { sort: { rank: SortingOrder.Ascending }, limit: 500 }
        );
    }

    async queryTasks(options: TaskQueryOptions): Promise<any[]> {
        const query: any = {};

        if (options.assignee) {
            query.assignee = options.assignee;
        }

        if (options.projectId) {
            query.space = options.projectId;
        }

        if (options.parentInternalId) {
            query.attachedTo = options.parentInternalId;
            query.collection = 'subIssues';
        }

        if (options.milestoneId) {
            query.milestone = options.milestoneId;
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

        // Sub-issues attach to the parent issue instead of the project. Huly
        // keeps the whole ancestor chain on the child (`parents[0]` is the
        // direct parent), so read it off the parent rather than rebuilding it.
        let parent: any = null;
        if (options.parentId) {
            parent = await this.client!.findOne(
                tracker.class.Issue as any,
                { _id: options.parentId } as any
            );
            if (!parent) {
                throw new Error(`Parent task not found: ${options.parentId}`);
            }
            if (parent.space !== project._id) {
                throw new Error(
                    `Parent ${parent.identifier} belongs to another project — a sub-issue must live in the same project as its parent`
                );
            }
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
            parents: parent
                ? [
                    {
                        parentId: parent._id,
                        parentTitle: parent.title,
                        identifier: parent.identifier,
                        space: parent.space,
                    },
                    ...(parent.parents || []),
                ]
                : [],
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
            project._id,                                    // space
            parent ? parent._id : project._id,              // attachedTo
            parent ? tracker.class.Issue : project._class,  // attachedToClass
            parent ? 'subIssues' : 'issues',                // collection name
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
            // SDK's uploadMarkup uses collaborator.createMarkup which only creates a blob
            // but does NOT update the collaborative document state that getMarkup reads.
            // Fix: use collaborator.updateMarkup to update the collab doc in-place.
            const c = this.client as any;
            const markupOps = c.markup;
            const collabClient = markupOps.collaborator;

            // Convert markdown → internal markup (same pipeline as SDK)
            const internalMarkup = jsonToMarkup(markdownToMarkup(options.descriptionMarkdown, {
                refUrl: markupOps.refUrl,
                imageUrl: markupOps.imageUrl,
            }));

            const collabId = makeCollabId(tracker.class.Issue as any, task._id, 'description');

            // Update collaborative document state (what getMarkup/fetchMarkup reads)
            await collabClient.updateMarkup(collabId, internalMarkup);

            // Do NOT call createMarkup — it may overwrite collab state.
            // Just keep existing description ref; the collab doc is now updated.
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

    /**
     * Edit a comment in place. Works for both ChatMessage and its ThreadMessage
     * replies — the collection coordinates come off the stored document, so the
     * caller only needs the message id.
     */
    async updateComment(messageId: string, message: string): Promise<void> {
        const comment = await this.getCommentById(messageId);
        if (!comment) throw new Error(`Khong tim thay comment: ${messageId}`);
        await this.client!.updateCollection(
            comment._class,
            comment.space,
            comment._id,
            comment.attachedTo,
            comment.attachedToClass,
            comment.collection,
            // Huly's own editor stamps editedOn; without it a listing cannot tell
            // an edited comment from an original one.
            { message, editedOn: Date.now() } as any
        );
    }

    async deleteComment(messageId: string): Promise<void> {
        const comment = await this.getCommentById(messageId);
        if (!comment) throw new Error(`Khong tim thay comment: ${messageId}`);
        await this.client!.removeCollection(
            comment._class,
            comment.space,
            comment._id,
            comment.attachedTo,
            comment.attachedToClass,
            comment.collection
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
    // Task types (kinds)
    // -----------------------------------------------------------------------

    /**
     * Task types available in a project. TaskType is scoped by ProjectType,
     * not by project — so the same kind name can exist under several project
     * types with different `_id`s, and only the one matching this project's
     * type is valid as `kindId` here.
     */
    async getTaskKinds(projectId: string): Promise<any[]> {
        const projects = await this.getProjects();
        const project = projects.find((p: any) => p._id === projectId);
        if (!project) return [];
        return await this.client!.findAll(
            task.class.TaskType as any,
            { parent: project.type } as any
        );
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
    // Activity feed
    // -----------------------------------------------------------------------

    /**
     * Fetch DocUpdateMessage events (status/assignee/label/etc changes)
     * for a given issue, newest first. We query the concrete class instead
     * of the abstract `ActivityMessage` so we can rely on the
     * `attributeUpdates` shape without polymorphic branching.
     */
    async getIssueDocUpdates(issueInternalId: string, limit: number = 200): Promise<any[]> {
        return await this.client!.findAll(
            activity.class.DocUpdateMessage as any,
            { attachedTo: issueInternalId, attachedToClass: tracker.class.Issue } as any,
            { sort: { modifiedOn: SortingOrder.Descending }, limit }
        );
    }

    /**
     * Fetch human comments (ChatMessage) attached to an issue.
     * Stored separately from DocUpdateMessage because their shape diverges:
     * comments carry `message: Markup`, updates carry `attributeUpdates`.
     */
    async getIssueComments(issueInternalId: string, limit: number = 200): Promise<any[]> {
        return await this.getComments(issueInternalId, tracker.class.Issue as any, limit);
    }

    /**
     * Generic comment fetch: ChatMessage attaches to any Doc (Issue,
     * Milestone, Document, Project, ...), so we key on `attachedTo` only.
     * `attachedToClass` is optional — `attachedTo` (_id) is globally unique,
     * so omitting the class avoids the class-mismatch trap while still
     * allowing an explicit filter when the caller wants one.
     */
    async getComments(
        attachedTo: string,
        attachedToClass?: string,
        limit: number = 200,
    ): Promise<any[]> {
        const query: any = { attachedTo };
        if (attachedToClass) query.attachedToClass = attachedToClass;
        return await this.client!.findAll(
            chunter.class.ChatMessage as any,
            query,
            { sort: { modifiedOn: SortingOrder.Descending }, limit }
        );
    }

    /**
     * Resolve a single comment by its ChatMessage _id — e.g. the `message`
     * query param in a Huly chunter deep-link.
     */
    async getCommentById(messageId: string): Promise<any | null> {
        return await this.client!.findOne(
            chunter.class.ChatMessage as any,
            { _id: messageId } as any
        );
    }

    /**
     * Fetch thread replies (ThreadMessage) — comments nested inside another
     * comment. A reply carries `objectId` (the root object, e.g. the issue)
     * and `attachedTo` (the parent comment). Pass `{ objectId }` to get every
     * reply on an object, or `{ attachedTo }` to get replies under one comment.
     * Sorted oldest-first so a thread reads top-to-bottom.
     */
    async getThreadReplies(filter: Record<string, any>, limit: number = 200): Promise<any[]> {
        return await this.client!.findAll(
            chunter.class.ThreadMessage as any,
            filter as any,
            { sort: { modifiedOn: SortingOrder.Ascending }, limit }
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

    /**
     * Convert an inline Markup value to markdown. ChatMessage/ThreadMessage
     * bodies store their content as a markup-JSON string (not a collaborative
     * blob), so `fetchMarkup` 500s on them — use this for comment bodies.
     */
    renderMarkup(value: string | null | undefined): string | null {
        if (!value) return null;
        try {
            return markupToMarkdown(markupToJSON(value));
        } catch {
            return null;
        }
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
