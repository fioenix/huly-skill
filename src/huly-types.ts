/**
 * Local type definitions for Huly platform classes.
 * Since @hcengineering/tracker, @hcengineering/contact, @hcengineering/document,
 * @hcengineering/tags, @hcengineering/rank are not installable without a GitHub PAT
 * with read:packages scope, we define the class references and types locally.
 *
 * These match the official huly-examples patterns from:
 * https://github.com/hcengineering/huly-examples
 */

import type { Ref, Class, Doc, Space, AttachedDoc } from '@hcengineering/core';

// ---------------------------------------------------------------------------
// Tracker module class references
// ---------------------------------------------------------------------------
export const tracker = {
  class: {
    Issue: 'tracker:class:Issue' as Ref<Class<Doc>>,
    Project: 'tracker:class:Project' as Ref<Class<Doc>>,
    IssueStatus: 'tracker:class:IssueStatus' as Ref<Class<Doc>>,
    Milestone: 'tracker:class:Milestone' as Ref<Class<Doc>>,
    Component: 'tracker:class:Component' as Ref<Class<Doc>>,
  },
  ids: {
    NoParent: 'tracker:ids:NoParent' as Ref<Doc>,
  },
  taskTypes: {
    Issue: 'tracker:taskTypes:Issue' as string,
  },
  category: {
    Other: 'tracker:category:Other' as Ref<Doc>,
  },
  status: {
    Done: 'tracker:status:Done' as Ref<Doc>,
    Canceled: 'tracker:status:Canceled' as Ref<Doc>,
  },
} as const;

// ---------------------------------------------------------------------------
// Contact module class references
// ---------------------------------------------------------------------------
export const contact = {
  class: {
    Person: 'contact:class:Person' as Ref<Class<Doc>>,
    Channel: 'contact:class:Channel' as Ref<Class<Doc>>,
    Member: 'contact:class:Member' as Ref<Class<Doc>>,
  },
  space: {
    Contacts: 'contact:space:Contacts' as Ref<Space>,
  },
  channelProvider: {
    Email: 'contact:channelProvider:Email' as string,
    Phone: 'contact:channelProvider:Phone' as string,
    Telegram: 'contact:channelProvider:Telegram' as string,
    GitHub: 'contact:channelProvider:GitHub' as string,
    LinkedIn: 'contact:channelProvider:LinkedIn' as string,
  },
} as const;

// ---------------------------------------------------------------------------
// Document module class references
// ---------------------------------------------------------------------------
export const document = {
  class: {
    Document: 'document:class:Document' as Ref<Class<Doc>>,
    Teamspace: 'document:class:Teamspace' as Ref<Class<Doc>>,
  },
  ids: {
    NoParent: 'document:ids:NoParent' as Ref<Doc>,
  },
  icon: {
    Teamspace: 'document:icon:Teamspace' as string,
  },
  spaceType: {
    DefaultTeamspaceType: 'document:spaceType:DefaultTeamspaceType' as string,
  },
} as const;

// ---------------------------------------------------------------------------
// Tags module class references
// ---------------------------------------------------------------------------
export const tags = {
  class: {
    TagElement: 'tags:class:TagElement' as Ref<Class<Doc>>,
    TagReference: 'tags:class:TagReference' as Ref<Class<Doc>>,
  },
} as const;

// ---------------------------------------------------------------------------
// Issue priority enum (matches @hcengineering/tracker IssuePriority)
// ---------------------------------------------------------------------------
export enum IssuePriority {
  NoPriority = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Urgent = 4,
}

// ---------------------------------------------------------------------------
// Milestone status enum
// ---------------------------------------------------------------------------
export enum MilestoneStatus {
  Planned = 0,
  InProgress = 1,
  Completed = 2,
  Cancelled = 3,
}

// ---------------------------------------------------------------------------
// Contact AvatarType enum
// ---------------------------------------------------------------------------
export enum AvatarType {
  COLOR = 'color',
  IMAGE = 'image',
  GRAVATAR = 'gravatar',
}

// ---------------------------------------------------------------------------
// Rank utility (simplified version of @hcengineering/rank makeRank)
// Uses lexorank-style string ranking.
// ---------------------------------------------------------------------------
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function makeRank(prev?: string, next?: string): string {
  if (!prev && !next) return 'a0';

  if (!prev) {
    // Insert before next
    const code = next!.charCodeAt(0);
    if (code > 49) { // '1'
      return String.fromCharCode(code - 1) + '0';
    }
    return next! + '0';
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
