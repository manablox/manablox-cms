import type {
  AuditAction,
  ContentTypeDefinition,
  ContentTypeKind,
  FieldReference,
  Scope,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {
  ContentFilter,
  ContentRow,
  ContentSort,
  DeleteChildren,
  Paginated,
  Pagination,
  Repositories,
  TreeChild,
  TreeNode,
} from '@manablox/db';
import { blockInstanceChecks } from '../block-extensions.js';
import { ContentCopy } from './copy.js';
import { ContentCore } from './core.js';
import { ContentPublishing } from './publishing.js';
import { ContentReads } from './reads.js';
import { collectReferences } from './references.js';
import type { Actor, ContentHookContext, ContentSaveInput, ContentSchedule } from './types.js';
import { initFields, validateContent } from './validation.js';
import { ContentWrites } from './writes.js';

export { withFreshBlockIds } from './copy.js';

/** Sequences validation, search text, permissions and hooks around each write. */
export class ContentService {
  private readonly core: ContentCore;
  private readonly reads: ContentReads;
  private readonly writes: ContentWrites;
  private readonly copies: ContentCopy;
  private readonly publishing: ContentPublishing;

  constructor(manablox: Manablox, repos: Repositories) {
    this.core = new ContentCore(manablox, repos, (bound) => ({
      repos: bound,
      content: bound === repos ? this : new ContentService(manablox, bound),
    }));
    this.reads = new ContentReads(this.core);
    this.writes = new ContentWrites(this.core);
    this.copies = new ContentCopy(this.core, this.writes);
    this.publishing = new ContentPublishing(this.core, this.writes);
  }

  /** This service on other repositories, e.g. a transaction's; hooks then run after commit. */
  using(repos: Repositories): ContentService {
    return new ContentService(this.core.manablox, repos);
  }

  /** Refuses `count` new rows of a `kind` type past its `documents` or `databagEntries` limit. */
  assertCountLimit(spaceId: Scope, kind: ContentTypeKind, count: number): Promise<void> {
    return this.core.assertCountLimit({ kind }, spaceId, count);
  }

  // Reads

  /** One document of the scope; another space's or environment's document reads as missing. */
  get(
    scope: Scope,
    id: string,
    options: { published?: boolean; actor?: Actor | null } = {},
  ): Promise<ContentRow | null> {
    return this.reads.get(scope, id, options);
  }

  list(
    filter: ContentFilter,
    pagination: Pagination,
    sorts: ContentSort[] = [],
    options: { published?: boolean; actor?: Actor | null } = {},
  ) {
    return this.reads.list(filter, pagination, sorts, options);
  }

  /** The tree below `rootId`; types outside `typeIds` drop out like hidden ones. */
  tree(
    scope: Scope,
    locale: string,
    rootId: string | null = null,
    options: { published?: boolean; actor?: Actor | null; typeIds?: string[] | null } = {},
  ): Promise<TreeNode[]> {
    return this.reads.tree(scope, locale, rootId, options);
  }

  /** One paged level; hidden types and those outside `typeIds` are skipped, their children kept. */
  treeChildren(
    scope: Scope,
    locale: string,
    parentId: string | null = null,
    options: {
      limit?: number;
      offset?: number;
      published?: boolean;
      actor?: Actor | null;
      typeIds?: string[] | null;
    } = {},
  ): Promise<Paginated<TreeChild>> {
    return this.reads.treeChildren(scope, locale, parentId, options);
  }

  /** Matching tree documents with their ancestors; see `ContentReads.treeSearch`. */
  treeSearch(
    ...args: Parameters<ContentReads['treeSearch']>
  ): ReturnType<ContentReads['treeSearch']> {
    return this.reads.treeSearch(...args);
  }

  /** Ancestors, root first, excluding hidden ones. */
  ancestorIds(scope: Scope, id: string): Promise<string[]> {
    return this.reads.ancestorIds(scope, id);
  }

  /** See `initFields` in `./validation.ts`. */
  initFields(
    contentType: ContentTypeDefinition,
    existing: Record<string, unknown> = {},
    locale = 'en',
  ): Promise<Record<string, unknown>> {
    return initFields(this.core.registry, contentType, existing, locale);
  }

  // Writes

  create(
    input: ContentSaveInput,
    actor: Actor | null = null,
    /** Audit action; a duplicate is not an ordinary creation. */
    action?: AuditAction,
  ): Promise<ContentRow> {
    return this.writes.create(input, actor, action);
  }

  /** The document stays in its space and environment whatever `input` says. */
  update(
    scope: Scope,
    id: string,
    input: ContentSaveInput,
    actor: Actor | null = null,
  ): Promise<ContentRow> {
    return this.writes.save(scope, id, input, actor, 'content.update');
  }

  /** Reparents or reorders a document. The caller checks permissions. */
  move(scope: Scope, id: string, parentId: string | null, position: number): Promise<ContentRow> {
    return this.writes.move(scope, id, parentId, position);
  }

  /** Every locale a document exists in, for the editor's language switcher. */
  translations(
    scope: Scope,
    id: string,
  ): Promise<{ id: string; locale: string; status: string; title: string }[]> {
    return this.writes.translations(scope, id);
  }

  /** Starts a translation copying the source's values; slugs are unique per locale. */
  createTranslation(
    scope: Scope,
    id: string,
    locale: string,
    actor: Actor | null = null,
  ): Promise<ContentRow> {
    return this.writes.createTranslation(scope, id, locale, actor);
  }

  /**
   * Copies a document beside the original as a draft, with fresh block ids and unique fields
   * left at their defaults. The copy is always `runtime` so the next sync does not claim it.
   * With `children`, the whole subtree below it is copied under the copy.
   */
  duplicate(
    scope: Scope,
    id: string,
    actor: Actor | null = null,
    options: { children?: boolean } = {},
  ): Promise<ContentRow> {
    return this.copies.duplicate(scope, id, actor, options);
  }

  /**
   * Creates a slugless folder, one row per locale sharing a `localizationId`. Locales
   * where the parent has no translation are skipped.
   */
  createFolder(
    scope: Scope,
    input: { title: string; locale: string; parentId?: string | null; position?: number },
    actor: Actor | null = null,
  ): Promise<{ primary: ContentRow; rows: ContentRow[] }> {
    return this.copies.createFolder(scope, input, actor);
  }

  /** Removes a document, and its children unless `children` is `reparent`; returns the count. */
  delete(
    scope: Scope,
    id: string,
    actor: Actor | null = null,
    children: DeleteChildren = 'cascade',
  ): Promise<number> {
    return this.writes.delete(scope, id, actor, children);
  }

  // Publishing and versions

  publish(scope: Scope, id: string, actor: Actor | null = null): Promise<ContentRow> {
    return this.publishing.publish(scope, id, actor);
  }

  /** Sets the publish window; an omitted key is kept, `null` clears it. */
  schedule(scope: Scope, id: string, schedule: ContentSchedule): Promise<ContentRow> {
    return this.publishing.schedule(scope, id, schedule);
  }

  /** Takes a document and its live descendants offline; each counts as unpublished. */
  unpublish(scope: Scope, id: string, actor: Actor | null = null): Promise<void> {
    return this.publishing.unpublish(scope, id, actor);
  }

  /** A page of stored versions, newest first. */
  versions(scope: Scope, id: string, pagination?: Pagination) {
    return this.reads.versions(scope, id, pagination);
  }

  /** The row as it was at `version`, with the fields the actor may not read stripped. */
  versionSnapshot(
    scope: Scope,
    id: string,
    version: number,
    actor: Actor | null = null,
  ): Promise<ContentRow | null> {
    return this.reads.versionSnapshot(scope, id, version, actor);
  }

  restore(
    scope: Scope,
    id: string,
    version: number,
    actor: Actor | null = null,
  ): Promise<ContentRow> {
    return this.publishing.restore(scope, id, version, actor);
  }

  // Validation, references, stored rows

  /** See `validateContent` in `./validation.ts`. */
  async validate(
    contentType: ContentTypeDefinition,
    values: Record<string, unknown>,
    input: ContentSaveInput,
    actor: Actor | null,
    hookContext: ContentHookContext | null = null,
  ): Promise<{ fields: Record<string, unknown>; searchText: string }> {
    return validateContent(
      this.core.registry,
      contentType,
      values,
      input,
      actor,
      hookContext,
      await blockInstanceChecks(this.core.manablox, input.spaceId),
    );
  }

  /** Every asset/content/user id reachable from a row, blocks included. */
  collectReferences(row: Pick<ContentRow, 'typeId' | 'fields'>): FieldReference[] {
    return collectReferences(this.core.registry, row);
  }

  /** The stored row when it is in the scope, else `null`; no read hooks. */
  stored(scope: Scope, id: string): Promise<ContentRow | null> {
    return this.reads.stored(scope, id);
  }

  /** The scope's stored rows by id; missing ids are absent, no read hooks. */
  storedMany(scope: Scope, ids: string[]): Promise<ContentRow[]> {
    return this.reads.storedMany(scope, ids);
  }
}
