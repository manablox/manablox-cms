import {
  resolveCodeRefs,
  TEMPLATE_BLOCKS_FIELD,
  TEMPLATE_TYPE_NAME,
  type TemplateDefinition,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceRow } from '@manablox/db';
import type { ResourcePlan, SpaceRows } from './plan.js';
import {
  type CodeResourceServices,
  codeTemplateId,
  entry,
  reasonOf,
  type SyncAction,
  type SyncChange,
  type SyncOptions,
  sameBlocks,
} from './shared.js';

/** Writes one template document per space locale through the content service. */
export async function syncTemplates(
  { manablox, services }: { manablox: Manablox; services: CodeResourceServices },
  space: SpaceRow,
  rows: SpaceRows,
  plan: ResourcePlan,
  options: SyncOptions,
): Promise<SyncChange[]> {
  const declared: TemplateDefinition[] = rows.declared.templates;
  if (declared.length === 0) return [];

  const changes: SyncChange[] = [];
  const type = manablox.contentTypes.tryGetByName(TEMPLATE_TYPE_NAME, space.id);
  if (!type) {
    // No `blocks` field type means no template type; see `Manablox.init`.
    return declared.map((definition) =>
      entry('template', definition.slug, space, 'skipped', 'this instance has no template type'),
    );
  }

  const resolve = plan.resolve;
  const actor = options.actorId ? { userId: options.actorId, roles: ['superadmin'] } : null;

  for (const definition of declared) {
    const change = (action: SyncAction, reason?: string): SyncChange =>
      entry('template', definition.slug, space, action, reason);

    const shared = definition.blocks.find((candidate) => candidate.locale === null);
    const perLocale = new Map(
      definition.blocks
        .filter((candidate) => candidate.locale !== null)
        .map((candidate) => [candidate.locale as string, candidate.value]),
    );
    const locales = space.locales.filter((locale) => shared !== undefined || perLocale.has(locale));
    if (locales.length === 0) {
      changes.push(change('skipped', 'the space has none of the locales it declares'));
      continue;
    }

    // One row per locale, stored like a translated document.
    const localizationId = codeTemplateId(rows.key, definition.slug, 'localization');

    // Reported once: created if any locale was, updated if any changed.
    let outcome: SyncAction = 'unchanged';
    let failure: string | null = null;

    // Locales stay sequential: a failing one stops the rest after the earlier writes.
    for (const locale of locales) {
      const id = codeTemplateId(rows.key, definition.slug, locale);
      const value =
        perLocale.get(locale) ?? (shared?.value as (typeof definition.blocks)[0]['value']);

      let blocks: unknown;
      try {
        blocks = resolveCodeRefs(value, resolve);
      } catch (error) {
        failure = reasonOf(error);
        break;
      }

      const current = rows.templates.get(id) ?? null;
      const managed = definition.manage === 'managed';

      // Managed: rewrite unless owned and identical (takes over seeded rows).
      if (current && (!managed || (current.source === 'code' && sameBlocks(current, blocks)))) {
        continue;
      }

      if (outcome !== 'created') outcome = current ? 'updated' : 'created';
      if (options.dryRun) continue;

      const input = {
        spaceId: space.id,
        environmentId: rows.environment.id,
        typeId: type.id,
        locale,
        localizationId,
        title: definition.title,
        fields: { [TEMPLATE_BLOCKS_FIELD]: blocks },
        // Only managed documents are owned and read-only in the admin.
        source: managed ? ('code' as const) : ('runtime' as const),
        sourceRef: definition.sourceRef ?? null,
      };

      const row = current
        ? await services.content.update(space.id, id, input, actor)
        : await services.content.create({ id, ...input }, actor);
      if (definition.publish && row.status !== 'published') {
        await services.content.publish(space.id, row.id, actor);
      }
    }

    changes.push(
      failure
        ? change('skipped', failure)
        : change(outcome, outcome === 'unchanged' ? undefined : `${locales.length} locale(s)`),
    );
  }
  return changes;
}

/** Code template documents whose declaration is gone are released, never deleted. */
export async function pruneTemplates(
  { repos }: { repos: Repositories },
  space: SpaceRow,
  rows: SpaceRows,
  options: SyncOptions,
): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  const templateIds = new Set<string>();
  for (const definition of rows.declared.templates) {
    for (const locale of space.locales) {
      templateIds.add(codeTemplateId(rows.key, definition.slug, locale));
    }
  }
  for (const row of rows.codeContent) {
    if (templateIds.has(row.id)) continue;
    changes.push(entry('template', row.slug, space, 'released'));
    if (options.dryRun) continue;
    await repos.content.setSource(row.id, 'runtime', null);
  }
  return changes;
}
