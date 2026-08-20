/**
 * Local type definitions for Huly platform classes.
 * Since @hcengineering/tracker, @hcengineering/contact, @hcengineering/document,
 * @hcengineering/tags are not installable without a GitHub PAT with
 * read:packages scope, we define the class references and types locally.
 *
 * These match the official huly-examples patterns from:
 * https://github.com/hcengineering/huly-examples
 */

import type { Ref, Class, Doc, Space, AttachedDoc } from '@hcengineering/core';
// Imported as a namespace, not by name: the package is CJS built with esbuild,
// so ESM named-export detection fails on it (same interop dance as client.ts).
import * as rankModule from '@hcengineering/rank';

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
// Task module class references
// ---------------------------------------------------------------------------
export const task = {
  class: {
    TaskType: 'task:class:TaskType' as Ref<Class<Doc>>,
  },
} as const;

// ---------------------------------------------------------------------------
// Contact module class references
// ---------------------------------------------------------------------------
export const contact = {
  mixin: {
    // Marks a Person as a workspace member; carries `active` and `role`.
    Employee: 'contact:mixin:Employee' as string,
  },
  class: {
    Person: 'contact:class:Person' as Ref<Class<Doc>>,
    Channel: 'contact:class:Channel' as Ref<Class<Doc>>,
    Member: 'contact:class:Member' as Ref<Class<Doc>>,
    SocialIdentity: 'contact:class:SocialIdentity' as Ref<Class<Doc>>,
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
// Activity / Chunter — class references for the issue activity feed
// ---------------------------------------------------------------------------
export const activity = {
  class: {
    ActivityMessage: 'activity:class:ActivityMessage' as Ref<Class<Doc>>,
    DocUpdateMessage: 'activity:class:DocUpdateMessage' as Ref<Class<Doc>>,
    ActivityInfoMessage: 'activity:class:ActivityInfoMessage' as Ref<Class<Doc>>,
    ActivityReference: 'activity:class:ActivityReference' as Ref<Class<Doc>>,
    Reaction: 'activity:class:Reaction' as Ref<Class<Doc>>,
  },
} as const;

export const chunter = {
  class: {
    ChatMessage: 'chunter:class:ChatMessage' as Ref<Class<Doc>>,
    ThreadMessage: 'chunter:class:ThreadMessage' as Ref<Class<Doc>>,
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
// Rank utility — delegates to the platform's LexoRank implementation.
// A hand-rolled version used to emit ranks outside LexoRank's base-36 alphabet
// (e.g. "0|i005efT"), which the Huly UI then refuses to parse — every attempt to
// create an issue in that project failed with "Failed to make rank … Not valid
// digit". Only the real implementation is safe to write into `rank`.
// ---------------------------------------------------------------------------
const platformMakeRank = (((rankModule as any).default ?? rankModule) as any).makeRank as
    (prev?: string, next?: string) => string;

export function makeRank(prev?: string, next?: string): string {
  // Ranks already corrupted by earlier releases cannot be parsed; ignore them
  // rather than propagating the failure, so a fresh valid rank is issued.
  try {
    return platformMakeRank(prev, next);
  } catch {
    return platformMakeRank(undefined, undefined);
  }
}
