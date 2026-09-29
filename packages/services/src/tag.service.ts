import {
  auditor,
  diffRecords,
  featureDenied,
  ManabloxError,
  purgeTags,
  type Scope,
  scopeSpaceId,
  slugify,
  snapshotChanges,
  spacePurgeTag,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type Repositories,
  rootRepositories,
  type TagRow,
  type TagWithCounts,
  whenCommitted,
} from '@manablox/db';
import { onWrite } from './content/listeners.js';
import { requireInSpace, resolveScope } from './lib.js';

export type { TagRow, TagWithCounts };

/** Longest tag name accepted; the rest is cut off rather than refused. */
export const TAG_NAME_MAX = 64;

/** Most tags one document or asset may carry. */
export const TAG_ASSIGNMENT_MAX = 50;

/** A name reduced to what is stored: trimmed, single-spaced, capped. */
export function normaliseTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX);
}

/** Names as unique `{ name, slug }` pairs, in the order given; unslugifiable names are dropped. */
export function toTagInputs(names: string[]): { name: string; slug: string }[] {
  const out = new Map<string, { name: string; slug: string }>();
  for (const raw of names) {
    const name = normaliseTagName(raw);
    const slug = slugify(name);
    if (!name || !slug || out.has(slug)) continue;
    out.set(slug, { name, slug });
  }
  return [...out.values()].slice(0, TAG_ASSIGNMENT_MAX);
}

/**
 * The tag vocabulary of a space and what carries which tag. Documents are tagged per
 * localization group, so every translation shows the same tags; assets are tagged per space.
 */
export class TagService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = auditor(repos, 'tag', (tag: TagRow) => tag.name);
  }

  /** This service on other repositories, e.g. a transaction's; purges then run after commit. */
  using(repos: Repositories): TagService {
    return new TagService(this.manablox, repos);
  }

  /** Runs `fn` on this service bound to a transaction. */
  private atomic<T>(fn: (service: TagService) => Promise<T>): Promise<T> {
    return this.repos.transaction((tx) => fn(this.using(tx)));
  }

  list(spaceId: string, search?: string): Promise<TagRow[]> {
    return this.repos.tags.listBySpace(spaceId, search);
  }

  /** The vocabulary with usage counts, for the management screen. */
  listWithCounts(spaceId: string, search?: string): Promise<TagWithCounts[]> {
    return this.repos.tags.listBySpaceWithCounts(spaceId, search);
  }

  /** Tags per localization group, for a listing or an editor. */
  ofContent(localizationIds: string[]): Promise<Map<string, TagRow[]>> {
    return this.repos.tags.listByLocalizations(localizationIds);
  }

  /** Tags per asset; `spaceId` narrows them to one space's vocabulary. */
  ofAssets(assetIds: string[], spaceId?: string | null): Promise<Map<string, TagRow[]>> {
    return this.repos.tags.listByAssets(assetIds, spaceId);
  }

  /** The named tags, creating the ones the space does not have yet. */
  async ensure(spaceId: string, names: string[], actorId: string | null = null): Promise<TagRow[]> {
    const inputs = toTagInputs(names);
    if (inputs.length === 0) return [];
    await this.assertOn(spaceId);
    return this.atomic(async (tags) => {
      const existing = await tags.repos.tags.listBySlugs(
        spaceId,
        inputs.map((input) => input.slug),
      );
      const known = new Set(existing.map((row) => row.slug));
      const rows = await tags.repos.tags.ensure(spaceId, inputs, actorId);
      const bySlug = new Map(rows.map((row) => [row.slug, row]));
      for (const row of rows) {
        if (!known.has(row.slug))
          await tags.audit.record('tag.create', row, snapshotChanges(row, 'created'));
      }
      // In the order asked for, so the caller can show them as typed.
      return inputs
        .map((input) => bySlug.get(input.slug))
        .filter((row): row is TagRow => Boolean(row));
    });
  }

  async create(spaceId: string, name: string, actorId: string | null = null): Promise<TagRow> {
    const [input] = toTagInputs([name]);
    if (!input) throw ManabloxError.badRequest('tag.name.required');
    const [taken] = await this.repos.tags.listBySlugs(spaceId, [input.slug]);
    if (taken) throw ManabloxError.badRequest('tag.name.taken', { name: taken.name });
    const [row] = await this.ensure(spaceId, [name], actorId);
    if (!row) throw ManabloxError.badRequest('tag.name.required');
    return row;
  }

  async rename(spaceId: string, id: string, name: string): Promise<TagRow> {
    await this.assertOn(spaceId);
    const before = await this.find(spaceId, id);
    const [input] = toTagInputs([name]);
    if (!input) throw ManabloxError.badRequest('tag.name.required');

    const [taken] = await this.repos.tags.listBySlugs(spaceId, [input.slug]);
    if (taken && taken.id !== id)
      throw ManabloxError.badRequest('tag.name.taken', { name: taken.name });

    return this.atomic(async (tags) => {
      const row = await tags.repos.tags.update(id, spaceId, input);
      await tags.purge(spaceId);
      await tags.audit.record('tag.update', row, diffRecords(before, row));
      return row;
    });
  }

  /** Moves everything tagged `sourceId` onto `targetId` and drops the source. */
  async merge(spaceId: string, sourceId: string, targetId: string): Promise<TagRow> {
    if (sourceId === targetId) throw ManabloxError.badRequest('tag.merge.sameTag');
    await this.assertOn(spaceId);
    const source = await this.find(spaceId, sourceId);
    const target = await this.find(spaceId, targetId);
    return this.atomic(async (tags) => {
      await tags.repos.tags.merge(sourceId, targetId, spaceId);
      await tags.purge(spaceId);
      await tags.audit.record('tag.merge', target, [
        { path: 'merged', from: source.name, to: target.name },
      ]);
      return target;
    });
  }

  async delete(spaceId: string, id: string): Promise<void> {
    await this.assertOn(spaceId);
    const row = await this.find(spaceId, id);
    await this.atomic(async (tags) => {
      await tags.repos.tags.delete(id, spaceId);
      await tags.purge(spaceId);
      await tags.audit.record('tag.delete', row, snapshotChanges(row, 'deleted'));
    });
  }

  /**
   * Replaces a document's tags, creating the names the space does not have yet. Tags are
   * shared by the space's environments; the assignment belongs to the document's.
   */
  async setForContent(
    scope: Scope,
    localizationId: string,
    names: string[],
    actorId: string | null = null,
  ): Promise<TagRow[]> {
    const spaceId = scopeSpaceId(scope);
    const unchanged = await this.unchangedWhileOff(spaceId, names, async () =>
      (await this.ofContent([localizationId])).get(localizationId),
    );
    if (unchanged) return unchanged;
    return this.atomic(async (tags) => {
      const rows = await tags.ensure(spaceId, names, actorId);
      await tags.repos.tags.setForLocalization(
        scope,
        localizationId,
        rows.map((row) => row.id),
      );
      await tags.purge(scope);
      return rows;
    });
  }

  /** Replaces an asset's tags within one space; other spaces' tags stay. */
  async setForAsset(
    spaceId: string,
    assetId: string,
    names: string[],
    actorId: string | null = null,
  ): Promise<TagRow[]> {
    const unchanged = await this.unchangedWhileOff(spaceId, names, async () =>
      (await this.ofAssets([assetId], spaceId)).get(assetId),
    );
    if (unchanged) return unchanged;
    return this.atomic(async (tags) => {
      const rows = await tags.ensure(spaceId, names, actorId);
      await tags.repos.tags.setForAsset(
        assetId,
        spaceId,
        rows.map((row) => row.id),
      );
      await tags.purge(spaceId);
      return rows;
    });
  }

  private assertOn(spaceId: string): Promise<void> {
    return this.manablox.controls.assertFeature(spaceId, 'tags');
  }

  /**
   * While tags are off, the current tags when `names` names exactly them, so a save that
   * resends them passes; any change is refused. `null` while tags are on.
   */
  private async unchangedWhileOff(
    spaceId: string,
    names: string[],
    current: () => Promise<TagRow[] | undefined>,
  ): Promise<TagRow[] | null> {
    const feature = await this.manablox.controls.feature(spaceId, 'tags');
    if (feature.enabled) return null;
    const rows = (await current()) ?? [];
    const wanted = toTagInputs(names).map((input) => input.slug);
    const held = new Set(rows.map((row) => row.slug));
    if (wanted.length === held.size && wanted.every((slug) => held.has(slug))) return rows;
    throw featureDenied('tags', feature);
  }

  /** Drops deleted documents' tags once their last translation is gone. */
  async forgetContent(localizationIds: readonly string[]): Promise<void> {
    await this.repos.tags.deleteByLocalizations(localizationIds);
  }

  /** `content_tags` keys a localization group, which no foreign key covers; runs in the delete's transaction. */
  attach(): void {
    onWrite(this.manablox, 'content:afterDeleteMany', async (rows, { spaceId }, repos) => {
      const localizationIds = rows.map((row) => row.localizationId);
      const [first] = rows;
      const scope = first ? { spaceId, environmentId: first.environmentId } : spaceId;
      const left = await repos.content.listExistingLocalizationIds(scope, localizationIds);
      const gone = [...new Set(localizationIds)].filter((id) => !left.has(id));
      if (gone.length) await this.using(repos).forgetContent(gone);
    });
  }

  // -------------------------------------------------------------------------

  private async find(spaceId: string, id: string): Promise<TagRow> {
    return requireInSpace(await this.repos.tags.findById(id, spaceId), spaceId, 'tag.notFound', {
      id,
    });
  }

  /** Tags travel with every document, so a change to them dates the whole space. */
  private purge(scope: Scope): Promise<void> {
    const spaceId = scopeSpaceId(scope);
    return whenCommitted(this.repos, async () =>
      purgeTags(this.manablox, spaceId, [
        typeof scope === 'string'
          ? `space:${spaceId}`
          : spacePurgeTag(await resolveScope(rootRepositories(this.repos), scope)),
      ]),
    );
  }
}
