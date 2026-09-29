import {
  type ContentManyHookContext,
  type ContentTypeDefinition,
  type ContentTypeRegistry,
  canHoldChildren,
  canNest,
  type HookServices,
  inScope,
  isDocumentType,
  ManabloxError,
  type ManabloxHooks,
  purgeTags,
  type ResolvedScope,
  type Scope,
  scopeOf,
  scopeSpaceId,
  slugify,
  spacePurgeTag,
  ValidationCollector,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type ContentRow,
  type Repositories,
  rootRepositories,
  uniqueViolation,
  whenCommitted,
} from '@manablox/db';
import { contentAuditor, requireInSpace, resolveScope } from '../lib.js';
import { runWriteListeners, type WriteEvent } from './listeners.js';
import { applyReadPermissions } from './permissions.js';
import type { Actor, ContentHookContext, ContentSaveInput } from './types.js';
import { uniqueChecks } from './validation.js';

/** Maps the (space, parent, locale) slug unique violation to a field error. */
export const slugConflict = uniqueViolation({
  constraint: 'sibling_slug',
  key: 'content.slug.duplicate',
  path: ['slug'],
  errorKey: 'content.validation.failed',
});

/** What an audit entry diffs: field values, not derived columns. */
export const CONTENT_DIFF = {
  expand: ['fields'],
  ignore: ['path', 'permalinkPath', 'permalinkSegment', 'createdBy', 'updatedBy', 'publishedAt'],
};

/** State and checks shared by the content service parts. */
export class ContentCore {
  /** Every write ends here; the actor comes from the request or run. */
  readonly audit;

  private bound: HookServices | undefined;
  private committed: HookServices | undefined;

  constructor(
    readonly manablox: Manablox,
    readonly repos: Repositories,
    /** The services hooks get for `repos`. */
    private readonly bind: (repos: Repositories) => HookServices,
  ) {
    this.audit = contentAuditor(repos);
  }

  /** Services on `repos`, for hooks run inside the write. */
  get services(): HookServices {
    this.bound ??= this.bind(this.repos);
    return this.bound;
  }

  /** Services outside any transaction, for hooks run after commit. */
  get committedServices(): HookServices {
    const root = rootRepositories(this.repos);
    this.committed ??= root === this.repos ? this.services : this.bind(root);
    return this.committed;
  }

  /** Runs `fn` in a transaction on a core bound to it; inside one, in a savepoint. */
  transaction<T>(fn: (core: ContentCore) => Promise<T>): Promise<T> {
    return this.repos.transaction((tx) => fn(new ContentCore(this.manablox, tx, this.bind)));
  }

  /** Runs the built-in listeners of `event` on this core's repositories. */
  listeners<K extends WriteEvent>(
    event: K,
    payload: ManabloxHooks[K][0],
    context: ManabloxHooks[K][1],
  ): Promise<void> {
    return runWriteListeners(
      this.manablox,
      event,
      payload,
      { ...context, services: this.services },
      this.repos,
    );
  }

  /** `context` for a hook run after commit. */
  committedContext<C extends object>(context: C): C & { services: HookServices } {
    return { ...context, services: this.committedServices };
  }

  /** Runs `fn` after commit when bound to a transaction, else now; `fn` must not use `repos`. */
  after(fn: () => unknown): Promise<void> {
    return whenCommitted(this.repos, fn);
  }

  get registry(): ContentTypeRegistry {
    return this.manablox.contentTypes;
  }

  /** The draft row, or not found when it belongs to another space or environment. */
  async find(scope: Scope, id: string): Promise<ContentRow> {
    return requireInSpace(await this.repos.content.findById(id), scope, 'content.notFound', {
      id,
    });
  }

  /** `scope` knowing whether it is production, for type lookups and cache tags. */
  resolve(scope: Scope): Promise<string | ResolvedScope> {
    return resolveScope(this.repos, scope);
  }

  /** Refuses a type that is not available in the scope, e.g. another environment's. */
  async assertTypeIn(contentType: ContentTypeDefinition, scope: Scope): Promise<void> {
    if (!this.registry.inScope(contentType, await this.resolve(scope))) {
      throw ManabloxError.notFound('contentType.notFound', { id: contentType.id });
    }
  }

  /** Read permissions applied; a row of an unknown type is left alone. */
  readable(row: ContentRow, actor: Actor | null): ContentRow {
    const type = this.registry.tryGet(row.typeId);
    return type ? applyReadPermissions(row, type, actor) : row;
  }

  /** Types hidden from the tree: templates, blocks, and types outside `readable`. */
  async hiddenTypeIds(scope: Scope, readable: string[] | null = null): Promise<string[]> {
    const allowed = readable ? new Set(readable) : null;
    return this.registry
      .forSpace(await this.resolve(scope))
      .filter((type) => !type.isVisibleInTree || (allowed !== null && !allowed.has(type.id)))
      .map((type) => type.id);
  }

  /** Refuses `unique` values held by another document's draft, or live copy if `published`. */
  async assertUnique(
    contentType: ContentTypeDefinition,
    values: Record<string, unknown>,
    scope: {
      spaceId: string;
      environmentId?: string | undefined;
      locale: string;
      localizationId: string | null;
    },
    published = false,
  ): Promise<void> {
    const checks = uniqueChecks(this.registry, contentType, values);
    if (checks.length === 0) return;

    const taken = new Set(
      await this.repos.content.listTakenFields(
        { ...scope, typeId: contentType.id },
        checks.map(({ field, value }) => ({ name: field.name, value, localized: field.localized })),
        published,
      ),
    );
    const collector = new ValidationCollector();
    for (const { field } of checks) {
      if (taken.has(field.name))
        collector.add('field.unique', [field.name], { field: field.label });
    }
    collector.throwIfAny('content.validation.failed');
  }

  assertWritable(contentType: ContentTypeDefinition): void {
    if (!isDocumentType(contentType)) {
      throw ManabloxError.badRequest('content.type.isBlock', { type: contentType.name });
    }
  }

  /** Databag entries need `databags`. */
  async assertFeatures(contentType: ContentTypeDefinition, scope: Scope): Promise<void> {
    if (contentType.kind === 'data') {
      await this.manablox.controls.assertFeature(scopeSpaceId(scope), 'databags');
    }
  }

  /** `documents` or `databagEntries`, whichever the type's rows count in; `count` new rows. */
  async assertCountLimit(
    contentType: Pick<ContentTypeDefinition, 'kind'>,
    spaceId: Scope,
    count = 1,
  ): Promise<void> {
    const key =
      contentType.kind === 'content'
        ? 'documents'
        : contentType.kind === 'data'
          ? 'databagEntries'
          : null;
    if (key && count > 0) {
      await this.manablox.controls.assertLimit(spaceId, key, { increment: count });
    }
  }

  /** Databag documents stay at the root and never hold children; a parent is in the scope. */
  async assertPlacement(
    contentType: ContentTypeDefinition,
    parentId: string | null,
    scope?: Scope,
  ): Promise<void> {
    if (!parentId) return;
    if (!canNest(contentType)) {
      throw ManabloxError.badRequest('content.data.hasParent', { type: contentType.name });
    }
    if (scope && typeof scope !== 'string') {
      const parent = await this.repos.content.findById(parentId);
      if (!parent || !inScope(parent, scope)) {
        throw ManabloxError.badRequest('content.parent.notInSpace', { parentId });
      }
    }
    const parentTypeId = await this.repos.content.findTypeId(parentId);
    const parentType = parentTypeId ? this.registry.tryGet(parentTypeId) : undefined;
    if (parentType && !canHoldChildren(parentType)) {
      throw ManabloxError.badRequest('content.parent.isData', { parentId });
    }
  }

  hookContext(
    contentType: ContentTypeDefinition,
    actor: Actor | null,
    scope: Scope,
    previous: ContentRow | null = null,
  ): ContentHookContext {
    return {
      manablox: this.manablox,
      contentType,
      actor,
      spaceId: scopeSpaceId(scope),
      ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
      previous: previous as never,
      services: this.services,
    };
  }

  hookContextFor(row: ContentRow, actor: Actor | null): ContentHookContext {
    return this.hookContext(this.registry.get(row.typeId), actor, scopeOf(row));
  }

  manyHookContext(root: ContentRow, actor: Actor | null): ContentManyHookContext {
    return {
      manablox: this.manablox,
      actor,
      spaceId: root.spaceId,
      environmentId: root.environmentId,
      rootId: root.id,
      services: this.services,
    };
  }

  /** One purge for rows of the same environment; runs after commit. */
  async purge(row: ContentRow, ...more: ContentRow[]): Promise<void> {
    const tags = new Set<string>();
    for (const each of [row, ...more]) tags.add(`content:${each.id}`).add(`type:${each.typeId}`);
    const scope = await resolveScope(rootRepositories(this.repos), scopeOf(row));
    // Publishing changes which assets a public asset list holds.
    tags.add(spacePurgeTag(scope)).add(`asset-list:${row.spaceId}`);
    await purgeTags(this.manablox, row.spaceId, [...tags]);
  }
}

/** A slug no sibling in the same environment, parent and locale holds. */
export async function freeSlug(
  repos: Repositories,
  scope: Scope,
  locale: string,
  parentId: string | null,
  candidate: string | undefined,
): Promise<string> {
  const base = candidate || 'item';
  const taken = new Set(await repos.content.listSiblingSlugs(scope, locale, parentId, 200));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function toWriteInput(input: ContentSaveInput) {
  return {
    ...(input.id ? { id: input.id } : {}),
    spaceId: input.spaceId,
    typeId: input.typeId,
    locale: input.locale ?? 'en',
    ...(input.localizationId ? { localizationId: input.localizationId } : {}),
    parentId: input.parentId ?? null,
    title: input.title,
    slug: input.slug ?? slugify(input.title ?? ''),
    fields: input.fields,
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.expectedVersion !== undefined ? { version: input.expectedVersion } : {}),
  };
}
