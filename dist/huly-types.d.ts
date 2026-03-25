/**
 * Local type definitions for Huly platform classes.
 * Since @hcengineering/tracker, @hcengineering/contact, @hcengineering/document,
 * @hcengineering/tags, @hcengineering/rank are not installable without a GitHub PAT
 * with read:packages scope, we define the class references and types locally.
 *
 * These match the official huly-examples patterns from:
 * https://github.com/hcengineering/huly-examples
 */
import type { Ref, Class, Doc, Space } from '@hcengineering/core';
export declare const tracker: {
    readonly class: {
        readonly Issue: Ref<Class<Doc>>;
        readonly Project: Ref<Class<Doc>>;
        readonly IssueStatus: Ref<Class<Doc>>;
        readonly Milestone: Ref<Class<Doc>>;
        readonly Component: Ref<Class<Doc>>;
    };
    readonly ids: {
        readonly NoParent: Ref<Doc>;
    };
    readonly taskTypes: {
        readonly Issue: string;
    };
    readonly category: {
        readonly Other: Ref<Doc>;
    };
    readonly status: {
        readonly Done: Ref<Doc>;
        readonly Canceled: Ref<Doc>;
    };
};
export declare const contact: {
    readonly class: {
        readonly Person: Ref<Class<Doc>>;
        readonly Channel: Ref<Class<Doc>>;
        readonly Member: Ref<Class<Doc>>;
    };
    readonly space: {
        readonly Contacts: Ref<Space>;
    };
    readonly channelProvider: {
        readonly Email: string;
        readonly Phone: string;
        readonly Telegram: string;
        readonly GitHub: string;
        readonly LinkedIn: string;
    };
};
export declare const document: {
    readonly class: {
        readonly Document: Ref<Class<Doc>>;
        readonly Teamspace: Ref<Class<Doc>>;
    };
    readonly ids: {
        readonly NoParent: Ref<Doc>;
    };
    readonly icon: {
        readonly Teamspace: string;
    };
    readonly spaceType: {
        readonly DefaultTeamspaceType: string;
    };
};
export declare const tags: {
    readonly class: {
        readonly TagElement: Ref<Class<Doc>>;
        readonly TagReference: Ref<Class<Doc>>;
    };
};
export declare enum IssuePriority {
    NoPriority = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Urgent = 4
}
export declare enum MilestoneStatus {
    Planned = 0,
    InProgress = 1,
    Completed = 2,
    Cancelled = 3
}
export declare enum AvatarType {
    COLOR = "color",
    IMAGE = "image",
    GRAVATAR = "gravatar"
}
export declare function makeRank(prev?: string, next?: string): string;
