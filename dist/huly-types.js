/**
 * Local type definitions for Huly platform classes.
 * Since @hcengineering/tracker, @hcengineering/contact, @hcengineering/document,
 * @hcengineering/tags, @hcengineering/rank are not installable without a GitHub PAT
 * with read:packages scope, we define the class references and types locally.
 *
 * These match the official huly-examples patterns from:
 * https://github.com/hcengineering/huly-examples
 */
// ---------------------------------------------------------------------------
// Tracker module class references
// ---------------------------------------------------------------------------
export const tracker = {
    class: {
        Issue: 'tracker:class:Issue',
        Project: 'tracker:class:Project',
        IssueStatus: 'tracker:class:IssueStatus',
        Milestone: 'tracker:class:Milestone',
        Component: 'tracker:class:Component',
    },
    ids: {
        NoParent: 'tracker:ids:NoParent',
    },
    taskTypes: {
        Issue: 'tracker:taskTypes:Issue',
    },
    category: {
        Other: 'tracker:category:Other',
    },
    status: {
        Done: 'tracker:status:Done',
        Canceled: 'tracker:status:Canceled',
    },
};
// ---------------------------------------------------------------------------
// Contact module class references
// ---------------------------------------------------------------------------
export const contact = {
    class: {
        Person: 'contact:class:Person',
        Channel: 'contact:class:Channel',
        Member: 'contact:class:Member',
    },
    space: {
        Contacts: 'contact:space:Contacts',
    },
    channelProvider: {
        Email: 'contact:channelProvider:Email',
        Phone: 'contact:channelProvider:Phone',
        Telegram: 'contact:channelProvider:Telegram',
        GitHub: 'contact:channelProvider:GitHub',
        LinkedIn: 'contact:channelProvider:LinkedIn',
    },
};
// ---------------------------------------------------------------------------
// Document module class references
// ---------------------------------------------------------------------------
export const document = {
    class: {
        Document: 'document:class:Document',
        Teamspace: 'document:class:Teamspace',
    },
    ids: {
        NoParent: 'document:ids:NoParent',
    },
    icon: {
        Teamspace: 'document:icon:Teamspace',
    },
    spaceType: {
        DefaultTeamspaceType: 'document:spaceType:DefaultTeamspaceType',
    },
};
// ---------------------------------------------------------------------------
// Tags module class references
// ---------------------------------------------------------------------------
export const tags = {
    class: {
        TagElement: 'tags:class:TagElement',
        TagReference: 'tags:class:TagReference',
    },
};
// ---------------------------------------------------------------------------
// Issue priority enum (matches @hcengineering/tracker IssuePriority)
// ---------------------------------------------------------------------------
export var IssuePriority;
(function (IssuePriority) {
    IssuePriority[IssuePriority["NoPriority"] = 0] = "NoPriority";
    IssuePriority[IssuePriority["Low"] = 1] = "Low";
    IssuePriority[IssuePriority["Medium"] = 2] = "Medium";
    IssuePriority[IssuePriority["High"] = 3] = "High";
    IssuePriority[IssuePriority["Urgent"] = 4] = "Urgent";
})(IssuePriority || (IssuePriority = {}));
// ---------------------------------------------------------------------------
// Milestone status enum
// ---------------------------------------------------------------------------
export var MilestoneStatus;
(function (MilestoneStatus) {
    MilestoneStatus[MilestoneStatus["Planned"] = 0] = "Planned";
    MilestoneStatus[MilestoneStatus["InProgress"] = 1] = "InProgress";
    MilestoneStatus[MilestoneStatus["Completed"] = 2] = "Completed";
    MilestoneStatus[MilestoneStatus["Cancelled"] = 3] = "Cancelled";
})(MilestoneStatus || (MilestoneStatus = {}));
// ---------------------------------------------------------------------------
// Contact AvatarType enum
// ---------------------------------------------------------------------------
export var AvatarType;
(function (AvatarType) {
    AvatarType["COLOR"] = "color";
    AvatarType["IMAGE"] = "image";
    AvatarType["GRAVATAR"] = "gravatar";
})(AvatarType || (AvatarType = {}));
// ---------------------------------------------------------------------------
// Rank utility (simplified version of @hcengineering/rank makeRank)
// Uses lexorank-style string ranking.
// ---------------------------------------------------------------------------
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function makeRank(prev, next) {
    if (!prev && !next)
        return 'a0';
    if (!prev) {
        // Insert before next
        const code = next.charCodeAt(0);
        if (code > 49) { // '1'
            return String.fromCharCode(code - 1) + '0';
        }
        return next + '0';
    }
    if (!next) {
        // Insert after prev
        const lastChar = prev.charCodeAt(prev.length - 1);
        if (lastChar < 122) { // 'z'
            return prev.slice(0, -1) + String.fromCharCode(lastChar + 1);
        }
        return prev + '0';
    }
    // Insert between prev and next
    // Find midpoint
    let i = 0;
    while (i < prev.length && i < next.length && prev[i] === next[i]) {
        i++;
    }
    if (i < prev.length && i < next.length) {
        const prevCode = ALPHABET.indexOf(prev[i]);
        const nextCode = ALPHABET.indexOf(next[i]);
        if (nextCode - prevCode > 1) {
            const midIdx = Math.floor((prevCode + nextCode) / 2);
            return prev.slice(0, i) + ALPHABET[midIdx];
        }
    }
    return prev + 'V'; // midpoint fallback
}
