import {
  copyName,
  FOLDER_TYPE_NAME,
  isDocumentType,
  isFolderType,
  ManabloxError,
  type Scope,
  scopeOf,
  scopeSpaceId,
} from '@manablox/core';
import { uuid as newUuid } from '@manablox/core/node';
import type { ContentRow, TreeNode } from '@manablox/db';
import { requireInSpace } from '../lib.js';
import { type ContentCore, freeSlug } from './core.js';
import type { Actor } from './types.js';
import { ContentWrites } from './writes.js';

/** Replaces every `blockId` and `itemId` structurally, so plugin value shapes are covered too. */
export function withFreshBlockIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => withFreshBlockIds(entry)) as T;
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      (key === 'blockId' || key === 'itemId') && typeof entry === 'string'
        ? newUuid()
        : withFreshBlockIds(entry);
  }
  return out as T;
}

/** Duplicates documents and subtrees, and creates folders across locales. */
export class ContentCopy {
  constructor(
    private readonly core: ContentCore,
    private readonly writes: ContentWrites,
  ) {}

  /** The copy and its subtree are written in one transaction. */
  duplicate(
    scope: Scope,
    id: string,
    actor: Actor | null,
    options: { children?: boolean },
  ): Promise<ContentRow> {
    return this.core.transaction((core) => this.using(core).copy(scope, id, actor, options));
  }

  /** This part on another core, e.g. a transaction's. */
  private using(core: ContentCore): ContentCopy {
    return new ContentCopy(core, new ContentWrites(core));
  }

  private async copy(
    scope: Scope,
    id: string,
    actor: Actor | null,
    options: { children?: boolean },
  ): Promise<ContentRow> {
    const source = await this.core.find(scope, id);
    const contentType = this.core.registry.get(source.typeId);
    this.core.assertWritable(contentType);
    const subtree = options.children
      ? await this.core.repos.content.listTree(scopeOf(source), source.locale, source.id)
      : [];
    // The whole copy at once; the rows below are documents.
    await this.core.assertCountLimit(
      contentType,
      scopeOf(source),
      1 + copiedCount(this.core, subtree),
    );

    const copy = await this.copyRow(source, source.parentId, copyName(source.title), {
      slug: `${source.slug}-copy`,
      position: source.position + 1,
      actor,
    });

    if (subtree.length > 0) await this.copySubtree(subtree, copy.id, actor);

    return copy;
  }

  /** Copies each node under `parentId`, depth first, keeping sibling order. */
  private async copySubtree(
    nodes: TreeNode[],
    parentId: string,
    actor: Actor | null,
  ): Promise<void> {
    for (const node of nodes) {
      const source = node.content;
      const contentType = this.core.registry.tryGet(source.typeId);
      // A type the space no longer defines cannot be validated; its subtree goes with it.
      if (!contentType || !isDocumentType(contentType)) continue;
      const copy = await this.copyRow(source, parentId, source.title, { actor });
      if (node.children.length > 0) await this.copySubtree(node.children, copy.id, actor);
    }
  }

  /** One copied row: fresh block ids, unique fields left at their defaults, a free slug. */
  private async copyRow(
    source: ContentRow,
    parentId: string | null,
    title: string,
    options: { slug?: string; position?: number; actor: Actor | null },
  ): Promise<ContentRow> {
    const contentType = this.core.registry.get(source.typeId);
    const slug = await freeSlug(
      this.core.repos,
      scopeOf(source),
      source.locale,
      parentId,
      options.slug ?? source.slug,
    );

    const fields = Object.fromEntries(
      Object.entries(withFreshBlockIds(source.fields)).filter(
        ([name]) => !contentType.fields.some((field) => field.name === name && field.unique),
      ),
    );
    return this.writes.create(
      {
        spaceId: source.spaceId,
        environmentId: source.environmentId,
        typeId: source.typeId,
        locale: source.locale,
        parentId,
        title,
        slug,
        fields,
        position: options.position ?? source.position,
      },
      options.actor,
      'content.duplicate',
      // The copy's own block data is what it keeps of plugins that are off.
      fields,
    );
  }

  /** Every locale's row or none. */
  createFolder(
    scope: Scope,
    input: { title: string; locale: string; parentId?: string | null; position?: number },
    actor: Actor | null,
  ): Promise<{ primary: ContentRow; rows: ContentRow[] }> {
    return this.core.transaction((core) => this.using(core).folder(scope, input, actor));
  }

  private async folder(
    scope: Scope,
    input: { title: string; locale: string; parentId?: string | null; position?: number },
    actor: Actor | null,
  ): Promise<{ primary: ContentRow; rows: ContentRow[] }> {
    const { repos, registry } = this.core;
    const spaceId = scopeSpaceId(scope);
    const folderType = registry.tryGetByName(FOLDER_TYPE_NAME, await this.core.resolve(scope));
    if (!folderType || !isFolderType(folderType)) {
      throw ManabloxError.badRequest('content.folder.typeMissing', { name: FOLDER_TYPE_NAME });
    }

    const parentId = input.parentId ?? null;
    const parent = parentId
      ? requireInSpace(await repos.content.findById(parentId), scope, 'content.notFound', {
          id: parentId,
        })
      : null;
    if (parent && parent.locale !== input.locale) {
      throw ManabloxError.badRequest('content.parent.otherLocale', { parentId });
    }

    // The parent's translation per locale.
    const parentByLocale = new Map<string, string>();
    if (parent) {
      const siblings = await repos.content.listByLocalization(
        scopeOf(parent),
        parent.localizationId,
      );
      for (const sibling of siblings) parentByLocale.set(sibling.locale, sibling.id);
      parentByLocale.set(parent.locale, parent.id);
    }

    const space = await repos.spaces.findById(spaceId);
    const locales = [input.locale, ...(space?.locales ?? [])].filter(
      (locale, index, all) => all.indexOf(locale) === index,
    );
    await this.core.assertCountLimit(folderType, scope, locales.length);

    const rows: ContentRow[] = [];
    let localizationId: string | undefined;

    for (const locale of locales) {
      const localeParent = parent ? (parentByLocale.get(locale) ?? null) : null;
      if (parent && !localeParent) continue;

      const row = await this.writes.create(
        {
          spaceId,
          ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
          typeId: folderType.id,
          locale,
          ...(localizationId ? { localizationId } : {}),
          parentId: localeParent,
          title: input.title,
          fields: {},
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
        actor,
        undefined,
      );
      localizationId = row.localizationId;
      rows.push(row);
    }

    const primary = rows.find((row) => row.locale === input.locale);
    // The requested locale is first, so `create` would already have thrown.
    if (!primary) throw new ManabloxError('content.create.failed');
    return { primary, rows };
  }
}

/** Rows `copySubtree` writes: nodes of known document types, with their subtrees. */
function copiedCount(core: ContentCore, nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    const type = core.registry.tryGet(node.content.typeId);
    if (!type || !isDocumentType(type)) continue;
    count += 1 + copiedCount(core, node.children);
  }
  return count;
}
