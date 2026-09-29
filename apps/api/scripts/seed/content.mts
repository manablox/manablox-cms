/**
 * The documents: templates, then the tree, then the menus that link into it.
 *
 * Field values are generated from the model rather than hardcoded, so a type built by
 * `model.mts` is filled in whatever fields it drew - and blocks are filled recursively,
 * which is how a document ends up with a block list holding blocks that hold block lists.
 *
 * Everything is written through `ContentService`, so validation, the search text, the
 * reference index, the audit trail and the cache purges are the ones an editor produces.
 */
import { randomUUID } from 'node:crypto';
import type { BlockValue, ContentTypeDefinition } from '@manablox/core';
import {
  chance,
  count,
  faker,
  freeSlug,
  maybeGrid,
  pick,
  richText,
  sample,
  sentence,
  title,
  words,
} from './random.mts';
import type { Asset, Content, ContentRow, Menus } from './types.mts';

/** Blocks nest as deep as the model allows; the seed stops well before the service does. */
const MAX_BLOCK_DEPTH = 3;

export interface ValueContext {
  /** Every type of the space, block types included, for looking a block's type up. */
  byId: Map<string, ContentTypeDefinition>;
  blockTypes: ContentTypeDefinition[];
  assets: Asset[];
  userIds: string[];
  /** Documents written so far, for relations and internal links. Grows as the tree does. */
  documents: ContentRow[];
  templateIds: string[];
  blocksPerField: [number, number];
}

const assetId = (context: ValueContext, accept: string[]): string | null => {
  const pool = accept.length
    ? context.assets.filter((asset) => accept.some((prefix) => asset.mimeType.startsWith(prefix)))
    : context.assets;
  return pool.length ? pick(pool).id : null;
};

const documentOf = (context: ValueContext, types: string[]): ContentRow | null => {
  const pool = types.length
    ? context.documents.filter((row) => types.includes(row.typeId))
    : context.documents;
  return pool.length ? pick(pool) : null;
};

/** One value for one field, by field type. Unknown types - a plugin's - are left alone. */
function fieldValue(
  field: ContentTypeDefinition['fields'][number],
  context: ValueContext,
  depth: number,
): unknown {
  const settings = field.settings as Record<string, unknown>;
  const multiple = settings.multiple === true;

  switch (field.type) {
    case 'string': {
      if (settings.editor === 'code') {
        return JSON.stringify(
          { [faker.word.noun()]: faker.word.words(3), enabled: chance(0.5) },
          null,
          2,
        );
      }
      const max = typeof settings.max === 'number' ? settings.max : 120;
      return (settings.editor === 'textarea' ? faker.lorem.paragraph() : title()).slice(0, max);
    }
    case 'richtext':
      return richText();
    case 'number': {
      const min = typeof settings.min === 'number' ? settings.min : 0;
      const max = typeof settings.max === 'number' ? settings.max : min + 1000;
      return settings.integer === true
        ? faker.number.int({ min, max })
        : Number(faker.number.float({ min, max, fractionDigits: 2 }).toFixed(2));
    }
    case 'boolean':
      return chance(0.5);
    case 'date': {
      const when = chance(0.5) ? faker.date.past({ years: 2 }) : faker.date.future({ years: 1 });
      return settings.mode === 'date' ? when.toISOString().slice(0, 10) : when.toISOString();
    }
    case 'select': {
      const options = (settings.options as { value: string }[] | undefined) ?? [];
      if (options.length === 0) return multiple ? [] : null;
      return multiple ? sample(options, 1, 3).map((option) => option.value) : pick(options).value;
    }
    case 'link': {
      // Half the links point into the space, which is the half that has to survive the
      // document at the other end being moved, unpublished or deleted.
      const target =
        settings.allowInternal !== false
          ? documentOf(context, (settings.types as string[]) ?? [])
          : null;
      const defaultTarget = settings.defaultTarget === '_blank' ? '_blank' : '_self';
      if (target && chance(0.5)) {
        return {
          mode: 'internal',
          contentId: target.id,
          url: null,
          target: defaultTarget,
          label: chance(0.5) ? words(3) : null,
        };
      }
      if (settings.allowExternal === false) return null;
      return {
        mode: 'external',
        contentId: null,
        url: faker.internet.url(),
        target: pick(['_self', '_blank']),
        label: chance(0.7) ? words(3) : null,
      };
    }
    case 'asset': {
      const accept = (settings.accept as string[] | undefined) ?? [];
      if (settings.selection === 'filter') return multiple ? [] : null;
      if (!multiple) return assetId(context, accept);
      const ids = Array.from({ length: count(0, 4) }, () => assetId(context, accept)).filter(
        (id): id is string => Boolean(id),
      );
      return [...new Set(ids)];
    }
    case 'content': {
      // A standing query stores nothing; delivery resolves it on every read.
      if (settings.selection === 'filter') return [];
      const types = (settings.types as string[] | undefined) ?? [];
      if (!multiple) return documentOf(context, types)?.id ?? null;
      const ids = Array.from({ length: count(0, 4) }, () => documentOf(context, types)?.id).filter(
        (id): id is string => Boolean(id),
      );
      return [...new Set(ids)];
    }
    case 'user': {
      if (context.userIds.length === 0) return multiple ? [] : null;
      return multiple ? sample(context.userIds, 0, 2) : pick(context.userIds);
    }
    case 'template':
      return context.templateIds.length ? pick(context.templateIds) : null;
    case 'block': {
      const type = context.byId.get(settings.type as string);
      return type && depth < MAX_BLOCK_DEPTH ? block(type, context, depth + 1) : null;
    }
    case 'blocks': {
      const allowed = (settings.types as string[] | undefined) ?? [];
      const pool = allowed.length
        ? context.blockTypes.filter((type) => allowed.includes(type.id))
        : context.blockTypes;
      if (pool.length === 0 || depth >= MAX_BLOCK_DEPTH) return { blocks: [] };
      // A nested list is short whatever the scale says. The scale's range is what a page
      // holds; applying it again one level down multiplies rather than adds, and a
      // document with sixty blocks in it is heavy in a way nobody is testing for.
      const [least, most] = depth === 0 ? context.blocksPerField : ([1, 3] as [number, number]);
      const max = typeof settings.max === 'number' ? Math.min(settings.max, most) : most;
      const total = count(Math.min(least, max), max);
      const grid = maybeGrid();
      const columns = grid?.desktop?.columns ?? 1;
      const blocks = Array.from({ length: total }, (_, index) => {
        const value = block(pick(pool), context, depth + 1);
        return columns > 1
          ? {
              ...value,
              layout: { column: (index % columns) + 1, row: Math.floor(index / columns) + 1 },
            }
          : value;
      });
      return grid ? { grid, blocks } : { blocks };
    }
    default:
      return null;
  }
}

/** One block of `type`, with every field of that type filled in. */
function block(type: ContentTypeDefinition, context: ValueContext, depth: number): BlockValue {
  return { blockId: randomUUID(), type: type.id, fields: valuesFor(type, context, depth) };
}

/** Every field of a type. Required fields always get a value; the rest usually do. */
function valuesFor(
  type: ContentTypeDefinition,
  context: ValueContext,
  depth = 0,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!field.required && chance(0.15)) continue;
    values[field.name] = fieldValue(field, context, depth);
  }
  return values;
}

/**
 * The content templates: documents of the system `template` type, holding one block list
 * each. Written before the document types are, so a `template` field has something to
 * offer, and published, because delivery reads the published projection - an unpublished
 * template delivers an empty block list wherever it is referenced.
 */
export async function buildTemplates(
  content: Content,
  spaceId: string,
  templateType: ContentTypeDefinition,
  locale: string,
  total: number,
  context: ValueContext,
  actor: { userId: string; roles: string[] } | null,
): Promise<ContentRow[]> {
  const field = templateType.fields.find((entry) => entry.type === 'blocks');
  const built: ContentRow[] = [];
  for (let index = 0; index < total; index++) {
    const row = await content.create(
      {
        spaceId,
        typeId: templateType.id,
        locale,
        title: `${pick(['Landing', 'Campaign', 'Editorial', 'Product', 'Support', 'Event'])} template ${index + 1}`,
        fields: field ? { [field.name]: fieldValue(field, context, 0) } : {},
      },
      actor,
    );
    if (chance(0.85)) await content.publish(spaceId, row.id, actor);
    built.push(row);
  }
  return built;
}

export interface TreeOptions {
  spaceId: string;
  locales: string[];
  roots: number;
  childrenPerNode: [number, number];
  depth: number;
  published: number;
  translated: number;
  /** Document types the tree is built from; folders come from the system type. */
  types: ContentTypeDefinition[];
  folderType: ContentTypeDefinition | null;
}

export interface TreeResult {
  documents: ContentRow[];
  folders: number;
  published: number;
  translations: number;
  scheduled: number;
  /** Publishes the database refused. Reported rather than swallowed. */
  failed: number;
}

/**
 * The tree. Breadth and depth both come from the scale, and every level is a mix: mostly
 * documents, a folder here and there, most of them published, some scheduled, some
 * translated. The slug is taken from the title and made free among its siblings by the
 * service; a collision is a technicality rather than a failure.
 */
export async function buildTree(
  content: Content,
  options: TreeOptions,
  context: ValueContext,
  actor: { userId: string; roles: string[] } | null,
  onProgress?: (created: number) => void,
): Promise<TreeResult> {
  const result: TreeResult = {
    documents: [],
    folders: 0,
    published: 0,
    translations: 0,
    scheduled: 0,
    failed: 0,
  };
  const locale = options.locales[0] ?? 'en';
  const others = options.locales.slice(1);

  // One set of slugs for the whole space rather than one per parent. Sibling uniqueness is
  // all the database asks for, but a folder contributes no permalink segment, so two
  // documents with the same slug under two different folders would publish to the same
  // address. Unique everywhere is the simple way for a seed not to trip over that.
  const slugs = new Set<string>();

  const level = async (parentId: string | null, depth: number, siblings: number): Promise<void> => {
    for (let index = 0; index < siblings; index++) {
      // Folders only in the middle of the tree: a leaf folder holds nothing, and a folder
      // at the root is what the tree already is.
      const asFolder =
        Boolean(options.folderType) && depth > 1 && depth < options.depth && chance(0.15);
      const type = asFolder ? (options.folderType as ContentTypeDefinition) : pick(options.types);
      const heading = asFolder ? `${faker.word.adjective()} ${faker.word.noun()}` : title();

      const row = await content.create(
        {
          spaceId: options.spaceId,
          typeId: type.id,
          locale,
          ...(parentId ? { parentId } : {}),
          title: heading,
          slug: freeSlug(heading, slugs),
          position: index,
          fields: valuesFor(type, context),
        },
        actor,
      );
      context.documents.push(row);
      result.documents.push(row);
      if (asFolder) result.folders += 1;
      onProgress?.(result.documents.length);

      if (type.isPublishable) {
        if (chance(options.published)) {
          // A publish can still be refused - a permalink another document already has, say.
          // One document that will not go live is no reason to stop filling the space.
          try {
            await content.publish(options.spaceId, row.id, actor);
            result.published += 1;
          } catch (error) {
            result.failed += 1;
            if (result.failed <= 5)
              console.warn(`    publish skipped: ${(error as Error).message}`);
          }
        } else if (chance(0.2)) {
          // A window in the future, so the scheduler's queue is not empty either. The end
          // is measured from the start: a window that closes before it opens is refused.
          const publishAt = faker.date.soon({ days: 30 });
          await content.schedule(options.spaceId, row.id, {
            publishAt,
            ...(chance(0.5)
              ? { unpublishAt: faker.date.soon({ days: count(7, 200), refDate: publishAt }) }
              : {}),
          });
          result.scheduled += 1;
        }
      }

      for (const other of others) {
        if (!chance(options.translated)) continue;
        const translation = await content.createTranslation(options.spaceId, row.id, other, actor);
        // A translation is written from the source's values; giving it its own title and
        // a fresh pass over the fields is what makes a locale switch visible.
        // An update is a full write: the parent and the position have to be restated, or
        // the translation is moved to the root and its slug meets the roots' slugs there.
        await content.update(
          options.spaceId,
          translation.id,
          {
            spaceId: options.spaceId,
            typeId: type.id,
            locale: other,
            ...(translation.parentId ? { parentId: translation.parentId } : {}),
            title: `${heading} (${other})`,
            slug: translation.slug ?? undefined,
            position: translation.position,
            fields: valuesFor(type, context),
          },
          actor,
        );
        result.translations += 1;
        if (type.isPublishable && chance(options.published)) {
          try {
            await content.publish(options.spaceId, translation.id, actor);
            result.published += 1;
          } catch (error) {
            result.failed += 1;
            if (result.failed <= 5)
              console.warn(`    publish skipped: ${(error as Error).message}`);
          }
        }
      }

      if (depth < options.depth) {
        await level(
          row.id,
          depth + 1,
          count(options.childrenPerNode[0], options.childrenPerNode[1]),
        );
      }
    }
  };

  await level(null, 1, options.roots);
  return result;
}

/**
 * The menus. Entries are a mix of documents and plain links, nested two deep, so the menu
 * editor has trees to drag rather than a flat list.
 */
/** An entry as `MenuService.setItems` takes it: a document, an address, or both. */
interface MenuItem {
  localizationId?: string | undefined;
  label?: string | undefined;
  url?: string | undefined;
  children?: MenuItem[] | undefined;
}

export async function buildMenus(
  menus: Menus,
  spaceId: string,
  total: number,
  documents: ContentRow[],
  taken: Set<string>,
): Promise<number> {
  const linkable = documents.filter((row) => row.status === 'published' || chance(0.3));
  const pool = linkable.length ? linkable : documents;
  if (pool.length === 0) return 0;

  const names = [
    'Main navigation',
    'Footer',
    'Legal',
    'Sidebar',
    'Top bar',
    'Support',
    'Campaigns',
    'Discover',
  ];
  let built = 0;
  for (let index = 0; index < total; index++) {
    const name = names[index % names.length] ?? `Menu ${index + 1}`;
    const menu = await menus.create({
      spaceId,
      name: index < names.length ? name : `${name} ${index + 1}`,
      machineName: freeSlug(name, taken),
      description: sentence(8),
    });

    const items: MenuItem[] = sample(pool, 3, 8).map((row) => ({
      localizationId: row.localizationId,
      ...(chance(0.3) ? { label: words(2) } : {}),
      children: chance(0.4)
        ? sample(pool, 1, 4).map((child) => ({ localizationId: child.localizationId }))
        : [],
    }));
    // A menu is not only a list of documents: an entry may be a plain address.
    if (chance(0.6)) items.push({ label: words(2), url: faker.internet.url() });

    await menus.setItems(spaceId, menu.id, items);
    built += 1;
  }
  return built;
}
