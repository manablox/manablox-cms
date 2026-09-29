import type { ContentTypeRegistry } from '@manablox/core';
import type { SQL } from 'drizzle-orm';
import type { Paginated } from '../pagination.js';
import type { ContentFilter, ContentSort, Pagination } from '../query.js';
import type { DatabaseContext } from './base.js';
import { ContentPublishing } from './content/publish.js';
import { ContentReads } from './content/reads.js';
import { ContentTree } from './content/tree.js';
import { ContentVersions } from './content/versions.js';
import { ContentWrites } from './content/writes.js';

export type { PublishedPermalink } from './content/publish.js';
export type {
  ContentWriteData,
  DeleteChildren,
  TreeChild,
  TreeNode,
} from './content/shared.js';
export type { ContentVersionSummary } from './content/versions.js';
export type { ContentFilter, ContentSort, Paginated, Pagination, SQL };

/**
 * Draft and published documents. Each concern is a part on one shared context: writes use
 * tree and versions, publishing uses tree; this class only forwards to them.
 */
export class ContentRepository {
  private readonly reads: ContentReads;
  private readonly tree: ContentTree;
  private readonly versions: ContentVersions;
  private readonly writes: ContentWrites;
  private readonly publishing: ContentPublishing;

  constructor(context: DatabaseContext, registry: ContentTypeRegistry) {
    this.reads = new ContentReads(context, registry);
    this.tree = new ContentTree(context, registry);
    this.versions = new ContentVersions(context);
    this.writes = new ContentWrites(context, this.tree, this.versions, registry);
    this.publishing = new ContentPublishing(context, this.tree);
  }

  // --- reads -------------------------------------------------------------------

  listCodeBySpace(
    ...args: Parameters<ContentReads['listCodeBySpace']>
  ): ReturnType<ContentReads['listCodeBySpace']> {
    return this.reads.listCodeBySpace(...args);
  }

  listCodeBySpaces(
    ...args: Parameters<ContentReads['listCodeBySpaces']>
  ): ReturnType<ContentReads['listCodeBySpaces']> {
    return this.reads.listCodeBySpaces(...args);
  }

  findById(...args: Parameters<ContentReads['findById']>): ReturnType<ContentReads['findById']> {
    return this.reads.findById(...args);
  }

  listByIds(...args: Parameters<ContentReads['listByIds']>): ReturnType<ContentReads['listByIds']> {
    return this.reads.listByIds(...args);
  }

  listByParents(
    ...args: Parameters<ContentReads['listByParents']>
  ): ReturnType<ContentReads['listByParents']> {
    return this.reads.listByParents(...args);
  }

  findByPermalink(
    ...args: Parameters<ContentReads['findByPermalink']>
  ): ReturnType<ContentReads['findByPermalink']> {
    return this.reads.findByPermalink(...args);
  }

  findHome(...args: Parameters<ContentReads['findHome']>): ReturnType<ContentReads['findHome']> {
    return this.reads.findHome(...args);
  }

  listByLocalizationIds(
    ...args: Parameters<ContentReads['listByLocalizationIds']>
  ): ReturnType<ContentReads['listByLocalizationIds']> {
    return this.reads.listByLocalizationIds(...args);
  }

  listByLocalization(
    ...args: Parameters<ContentReads['listByLocalization']>
  ): ReturnType<ContentReads['listByLocalization']> {
    return this.reads.listByLocalization(...args);
  }

  listExistingLocalizationIds(
    ...args: Parameters<ContentReads['listExistingLocalizationIds']>
  ): ReturnType<ContentReads['listExistingLocalizationIds']> {
    return this.reads.listExistingLocalizationIds(...args);
  }

  listLocalizationSiblingIds(
    ...args: Parameters<ContentReads['listLocalizationSiblingIds']>
  ): ReturnType<ContentReads['listLocalizationSiblingIds']> {
    return this.reads.listLocalizationSiblingIds(...args);
  }

  findTypeId(
    ...args: Parameters<ContentReads['findTypeId']>
  ): ReturnType<ContentReads['findTypeId']> {
    return this.reads.findTypeId(...args);
  }

  listSiblingSlugs(
    ...args: Parameters<ContentReads['listSiblingSlugs']>
  ): ReturnType<ContentReads['listSiblingSlugs']> {
    return this.reads.listSiblingSlugs(...args);
  }

  page(...args: Parameters<ContentReads['page']>): ReturnType<ContentReads['page']> {
    return this.reads.page(...args);
  }

  batches(...args: Parameters<ContentReads['batches']>): ReturnType<ContentReads['batches']> {
    return this.reads.batches(...args);
  }

  countSummary(
    ...args: Parameters<ContentReads['countSummary']>
  ): ReturnType<ContentReads['countSummary']> {
    return this.reads.countSummary(...args);
  }

  listTakenFields(
    ...args: Parameters<ContentReads['listTakenFields']>
  ): ReturnType<ContentReads['listTakenFields']> {
    return this.reads.listTakenFields(...args);
  }

  // --- tree --------------------------------------------------------------------

  listTree(...args: Parameters<ContentTree['listTree']>): ReturnType<ContentTree['listTree']> {
    return this.tree.listTree(...args);
  }

  pageTreeChildren(
    ...args: Parameters<ContentTree['pageTreeChildren']>
  ): ReturnType<ContentTree['pageTreeChildren']> {
    return this.tree.pageTreeChildren(...args);
  }

  listAncestors(
    ...args: Parameters<ContentTree['listAncestors']>
  ): ReturnType<ContentTree['listAncestors']> {
    return this.tree.listAncestors(...args);
  }

  move(...args: Parameters<ContentTree['move']>): ReturnType<ContentTree['move']> {
    return this.tree.move(...args);
  }

  deleteReturning(
    ...args: Parameters<ContentTree['deleteReturning']>
  ): ReturnType<ContentTree['deleteReturning']> {
    return this.tree.deleteReturning(...args);
  }

  // --- versions ----------------------------------------------------------------

  pageVersions(
    ...args: Parameters<ContentVersions['pageVersions']>
  ): ReturnType<ContentVersions['pageVersions']> {
    return this.versions.pageVersions(...args);
  }

  pruneVersions(
    ...args: Parameters<ContentVersions['pruneVersions']>
  ): ReturnType<ContentVersions['pruneVersions']> {
    return this.versions.pruneVersions(...args);
  }

  findVersionSnapshot(
    ...args: Parameters<ContentVersions['findVersionSnapshot']>
  ): ReturnType<ContentVersions['findVersionSnapshot']> {
    return this.versions.findVersionSnapshot(...args);
  }

  listVersions(
    ...args: Parameters<ContentVersions['listVersions']>
  ): ReturnType<ContentVersions['listVersions']> {
    return this.versions.listVersions(...args);
  }

  restoreHistory(
    ...args: Parameters<ContentVersions['restoreHistory']>
  ): ReturnType<ContentVersions['restoreHistory']> {
    return this.versions.restoreHistory(...args);
  }

  restoreHistoryMany(
    ...args: Parameters<ContentVersions['restoreHistoryMany']>
  ): ReturnType<ContentVersions['restoreHistoryMany']> {
    return this.versions.restoreHistoryMany(...args);
  }

  // --- writes ------------------------------------------------------------------

  create(...args: Parameters<ContentWrites['create']>): ReturnType<ContentWrites['create']> {
    return this.writes.create(...args);
  }

  update(...args: Parameters<ContentWrites['update']>): ReturnType<ContentWrites['update']> {
    return this.writes.update(...args);
  }

  patchFields(
    ...args: Parameters<ContentWrites['patchFields']>
  ): ReturnType<ContentWrites['patchFields']> {
    return this.writes.patchFields(...args);
  }

  setSource(
    ...args: Parameters<ContentWrites['setSource']>
  ): ReturnType<ContentWrites['setSource']> {
    return this.writes.setSource(...args);
  }

  // --- publishing --------------------------------------------------------------

  publish(
    ...args: Parameters<ContentPublishing['publish']>
  ): ReturnType<ContentPublishing['publish']> {
    return this.publishing.publish(...args);
  }

  publishedPermalinks(
    ...args: Parameters<ContentPublishing['publishedPermalinks']>
  ): ReturnType<ContentPublishing['publishedPermalinks']> {
    return this.publishing.publishedPermalinks(...args);
  }

  unpublish(
    ...args: Parameters<ContentPublishing['unpublish']>
  ): ReturnType<ContentPublishing['unpublish']> {
    return this.publishing.unpublish(...args);
  }

  setSchedule(
    ...args: Parameters<ContentPublishing['setSchedule']>
  ): ReturnType<ContentPublishing['setSchedule']> {
    return this.publishing.setSchedule(...args);
  }

  claimDuePublications(
    ...args: Parameters<ContentPublishing['claimDuePublications']>
  ): ReturnType<ContentPublishing['claimDuePublications']> {
    return this.publishing.claimDuePublications(...args);
  }

  claimDueUnpublications(
    ...args: Parameters<ContentPublishing['claimDueUnpublications']>
  ): ReturnType<ContentPublishing['claimDueUnpublications']> {
    return this.publishing.claimDueUnpublications(...args);
  }

  restoreDates(
    ...args: Parameters<ContentPublishing['restoreDates']>
  ): ReturnType<ContentPublishing['restoreDates']> {
    return this.publishing.restoreDates(...args);
  }

  restoreDatesMany(
    ...args: Parameters<ContentPublishing['restoreDatesMany']>
  ): ReturnType<ContentPublishing['restoreDatesMany']> {
    return this.publishing.restoreDatesMany(...args);
  }
}
