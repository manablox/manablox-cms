import type {
  ContentRecord,
  ContentTypeDefinition,
  HookServices,
  ResourceSource,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ContentService } from './service.js';

declare module '@manablox/core' {
  interface HookServices {
    /** The write's repositories, or the root ones after commit. */
    repos: Repositories;
    /** Content service on `repos`. */
    content: ContentService;
  }
}

export interface Actor {
  userId: string;
  roles: string[];
}

export interface ContentSaveInput {
  id?: string | undefined;
  spaceId: string;
  /** On create; the space's production environment when absent. */
  environmentId?: string | undefined;
  typeId: string;
  locale?: string | undefined;
  localizationId?: string | undefined;
  parentId?: string | null | undefined;
  title: string;
  slug?: string | undefined;
  fields: Record<string, unknown>;
  position?: number | undefined;
  /** `code` documents are config-owned; only the reconciler writes them. */
  source?: ResourceSource | undefined;
  sourceRef?: string | null | undefined;
  expectedVersion?: number | undefined;
}

/** A publish window; an omitted key is kept, `null` clears it. */
export interface ContentSchedule {
  publishAt?: Date | null | undefined;
  unpublishAt?: Date | null | undefined;
}

/** What every content hook receives alongside its payload. */
export interface ContentHookContext {
  manablox: Manablox;
  contentType: ContentTypeDefinition;
  actor: Actor | null;
  spaceId: string;
  /** The document's environment. */
  environmentId?: string | undefined;
  /** On update, the row before the write. */
  previous?: ContentRecord | null;
  /** Set on write hooks: bound to the write's transaction, the root services after commit. */
  services?: HookServices;
}
