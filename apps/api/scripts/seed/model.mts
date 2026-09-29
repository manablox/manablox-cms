/**
 * The content model a seeded space gets: block types first, then the document types
 * built out of them. Every field type the instance ships with turns up somewhere, and
 * with settings that differ from field to field - a seed whose asset fields all accept
 * everything and whose selects all have three options tests one form, not the forms.
 *
 * Written through `ContentTypeService`, so the registry reloads and the grants, the
 * audit entries and the GraphQL schema are the ones a hand-built type would produce.
 */
import type { ContentTypeDefinition, ContentTypeInput, FieldInput } from '@manablox/core';
import type { ContentTypeService } from '@manablox/services';
import { chance, count, faker, freeName, pick, sample, sentence, words } from './random.mts';

/** What a field builder may point at. Filled in as the model is built, in order. */
export interface FieldContext {
  /** Block type ids a `block` or `blocks` field may hold. */
  blockTypeIds: string[];
  /** Content type ids a `content` field or a link may point at. */
  contentTypeIds: string[];
  /** Template document ids a `template` field may offer. */
  templateIds: string[];
}

type FieldBuilder = (name: string, context: FieldContext) => FieldInput;

const help = () => (chance(0.4) ? { help: sentence(6) } : {});

/**
 * Field types that get the full width and stay out of the sidebar. A block list in a
 * quarter-width column in the sidebar is a form nobody would build by hand, and it is the
 * page builder that a seeded document is there to show.
 */
const FULL_WIDTH = new Set(['richtext', 'blocks', 'block', 'template']);

/** `admin` settings: where the field sits and how wide it is, by what it holds. */
const admin = (type: string, editor?: unknown) => {
  if (FULL_WIDTH.has(type) || editor === 'code' || editor === 'textarea') {
    return { zone: 'main' as const, width: 100, ...help() };
  }
  return {
    zone: chance(0.25) ? ('sidebar' as const) : ('main' as const),
    width: pick([100, 100, 50, 50, 33, 25]),
    ...help(),
  };
};

const base = (name: string, type: string, extra: Partial<FieldInput> = {}): FieldInput => ({
  name,
  type,
  required: chance(0.2),
  localized: chance(0.4),
  ...extra,
  admin: admin(type, (extra.settings as { editor?: unknown } | undefined)?.editor),
});

/**
 * One builder per field type, several for the types with settings worth varying. Sampled
 * rather than used in order, so two types of the same seed rarely look alike.
 */
const BUILDERS: Record<string, FieldBuilder> = {
  string: (name) =>
    base(name, 'string', {
      settings: chance(0.3)
        ? { editor: 'textarea', max: count(200, 600) }
        : { editor: 'input', max: count(60, 200), ...(chance(0.2) ? { default: words(3) } : {}) },
    }),
  code: (name) =>
    base(name, 'string', {
      settings: { editor: 'code', language: pick(['json', 'html', 'css', 'markdown', 'yaml']) },
    }),
  richtext: (name) =>
    base(name, 'richtext', {
      settings: {
        toolbar: sample(
          [
            'bold',
            'italic',
            'strike',
            'code',
            'link',
            'heading',
            'bulletList',
            'orderedList',
            'blockquote',
            'codeBlock',
          ],
          4,
          9,
        ),
        ...(chance(0.3) ? { maxLength: count(2000, 20000) } : {}),
      },
    }),
  number: (name) =>
    base(name, 'number', {
      settings: chance(0.4)
        ? { format: 'currency', currency: pick(['EUR', 'USD', 'GBP']), min: 0, step: 0.5 }
        : { integer: true, min: 0, max: count(100, 10000) },
    }),
  boolean: (name) => base(name, 'boolean', { settings: { default: chance(0.5) } }),
  date: (name) =>
    base(name, 'date', {
      settings: chance(0.5)
        ? { mode: 'date', defaultNow: chance(0.5) }
        : { mode: 'datetime', defaultNow: chance(0.3) },
    }),
  select: (name) => {
    const options = Array.from({ length: count(3, 8) }, () => {
      const label = faker.word.adjective();
      return { value: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label };
    });
    const unique = [...new Map(options.map((option) => [option.value, option])).values()];
    return base(name, 'select', { settings: { options: unique, multiple: chance(0.35) } });
  },
  link: (name, context) =>
    base(name, 'link', {
      required: false,
      settings: {
        allowInternal: true,
        allowExternal: chance(0.8),
        types: chance(0.4) ? sample(context.contentTypeIds, 1, 3) : [],
        allowTarget: true,
        defaultTarget: pick(['_self', '_blank']),
      },
    }),
  // A relation is never marked required. What it points at has to exist for the value to
  // validate, and the seed fills a block used by a template before there is a document to
  // point at - a required relation there would be a document that cannot be written.
  asset: (name) =>
    base(name, 'asset', {
      required: false,
      settings: {
        multiple: chance(0.35),
        accept: pick([['image/'], ['image/', 'video/'], [], ['application/pdf', 'text/']]),
        sizes: chance(0.5)
          ? [
              { name: 'card', width: 640, height: 360, fit: 'cover', format: 'webp' },
              { name: 'wide', width: 1600, height: 900, fit: 'cover', format: 'avif', quality: 70 },
            ]
          : [],
      },
    }),
  content: (name, context) =>
    base(name, 'content', {
      required: false,
      settings: chance(0.3)
        ? {
            // A standing query: nothing is stored, and delivery resolves it on every read.
            multiple: true,
            selection: 'filter',
            types: sample(context.contentTypeIds, 1, 3),
            limit: count(3, 20),
            sortBy: pick(['position', 'title', 'createdAt', 'publishedAt']),
            sortDirection: pick(['asc', 'desc']),
          }
        : { multiple: chance(0.5), types: sample(context.contentTypeIds, 0, 3) },
    }),
  user: (name) => base(name, 'user', { required: false, settings: { multiple: chance(0.3) } }),
  block: (name, context) => {
    const type = pick(context.blockTypeIds);
    return base(name, 'block', { required: false, settings: { type }, localized: false });
  },
  // Never required either: nesting stops at `MAX_BLOCK_DEPTH`, where a list stays empty.
  blocks: (name, context) =>
    base(name, 'blocks', {
      required: false,
      settings: {
        types: chance(0.6) ? sample(context.blockTypeIds, 2, 6) : [],
        ...(chance(0.2) ? { max: count(4, 20) } : {}),
      },
      localized: chance(0.6),
    }),
  template: (name, context) =>
    base(name, 'template', {
      required: false,
      settings: { templates: sample(context.templateIds, 1, 4) },
      localized: false,
    }),
};

/**
 * Field names per field type rather than one pool for all of them. A `date` called
 * `hero_image` is a seed nobody can read, and a screenshot of it says nothing about the
 * admin it was taken from.
 */
const FIELD_NAMES: Record<string, string[]> = {
  string: ['headline', 'subtitle', 'kicker', 'strapline', 'summary', 'excerpt', 'location_name'],
  code: ['raw_config', 'embed_code', 'custom_styles', 'tracking_snippet'],
  richtext: ['body', 'intro', 'description', 'notes', 'terms'],
  number: ['price', 'stock', 'rating', 'duration_minutes', 'capacity', 'sort_weight'],
  boolean: ['is_featured', 'is_archived', 'show_in_footer', 'allow_comments', 'hide_from_search'],
  date: ['published_on', 'starts_at', 'ends_at', 'reviewed_at', 'available_from'],
  select: ['category', 'tone', 'audience', 'status_label', 'region', 'difficulty'],
  link: ['primary_link', 'secondary_link', 'call_to_action', 'source_link'],
  asset: ['hero_image', 'gallery', 'attachments', 'poster', 'brochure', 'logo'],
  content: ['related', 'parent_topic', 'see_also', 'featured_items', 'collection'],
  user: ['author', 'reviewers', 'owner', 'contact'],
  block: ['lead_block', 'highlight', 'aside'],
  blocks: ['sections', 'components', 'aside_blocks', 'body_blocks'],
  template: ['layout_template', 'shared_layout'],
};

const TYPE_NAMES = [
  'article',
  'landing_page',
  'product',
  'event',
  'person',
  'press_release',
  'recipe',
  'job_posting',
  'case_study',
  'faq_entry',
  'course',
  'venue',
  'campaign',
  'changelog_entry',
  'podcast_episode',
  'whitepaper',
  'partner',
  'testimonial',
];

const LEAF_BLOCK_NAMES = [
  'hero',
  'text_media',
  'quote',
  'cta',
  'stat',
  'video_embed',
  'image_banner',
  'code_sample',
  'divider',
  'form_embed',
  'map',
  'countdown',
  'price_card',
  'author_note',
];

const COMPOSITE_BLOCK_NAMES = [
  'card_grid',
  'accordion',
  'tabs',
  'timeline',
  'two_column',
  'carousel',
  'feature_matrix',
];

/**
 * Picks `n` builders and gives each a free name. The pool is finite, so a type asking for
 * more fields than there are names gets numbered ones - which is itself worth having in
 * a seed, since that is what a grown model looks like.
 */
function buildFields(n: number, context: FieldContext, allowed: string[]): FieldInput[] {
  const taken = new Set<string>();
  const fields: FieldInput[] = [];
  for (let index = 0; index < n; index++) {
    const kind = pick(allowed);
    const builder = BUILDERS[kind];
    if (!builder) continue;
    const name = freeName(pick(FIELD_NAMES[kind] ?? [kind]), taken);
    fields.push(builder(name, context));
  }
  return fields;
}

const SCALARS = [
  'string',
  'string',
  'code',
  'richtext',
  'number',
  'boolean',
  'date',
  'select',
  'link',
  'asset',
  'content',
  'user',
];

/**
 * The block types. Leaves first - they hold scalars only - then composites, which hold
 * the leaves, so a document ends up with blocks inside blocks and the editor's nesting
 * is exercised rather than assumed.
 */
export async function buildBlockTypes(
  contentTypes: ContentTypeService,
  spaceId: string,
  total: number,
  createdBy: string | null,
  fields: [number, number],
): Promise<ContentTypeDefinition[]> {
  const taken = new Set(contentTypes.list(spaceId).map((type) => type.name));
  const leafCount = Math.max(1, Math.round(total * 0.65));
  const built: ContentTypeDefinition[] = [];

  for (let index = 0; index < total; index++) {
    const leaf = index < leafCount;
    const pool = leaf ? LEAF_BLOCK_NAMES : COMPOSITE_BLOCK_NAMES;
    const context: FieldContext = {
      blockTypeIds: built.map((type) => type.id),
      contentTypeIds: [],
      templateIds: [],
    };
    const allowed =
      leaf || context.blockTypeIds.length === 0
        ? SCALARS
        : [...SCALARS, 'blocks', 'block', 'blocks'];
    const input: ContentTypeInput = {
      name: freeName(pool[index % pool.length] ?? 'block', taken),
      description: sentence(8),
      kind: 'block',
      spaceId,
      icon: pick([
        'i-lucide-square',
        'i-lucide-layout-grid',
        'i-lucide-image',
        'i-lucide-quote',
        'i-lucide-list',
      ]),
      fields: buildFields(
        count(fields[0], Math.max(fields[0], Math.round(fields[1] * 0.7))),
        context,
        allowed,
      ),
    };
    built.push(await contentTypes.create(input, createdBy));
  }
  return built;
}

/**
 * The document types. Two passes: the first without relations to types that do not exist
 * yet, the second re-saving a few of them so `content` fields and internal links point at
 * their siblings - which is what a real model looks like and what the reference walker
 * needs something to walk.
 */
export async function buildContentTypes(
  contentTypes: ContentTypeService,
  spaceId: string,
  total: number,
  createdBy: string | null,
  context: Omit<FieldContext, 'contentTypeIds'>,
  fields: [number, number],
): Promise<ContentTypeDefinition[]> {
  const taken = new Set(contentTypes.list(spaceId).map((type) => type.name));
  const built: ContentTypeDefinition[] = [];

  for (let index = 0; index < total; index++) {
    const full: FieldContext = { ...context, contentTypeIds: built.map((type) => type.id) };
    const allowed = [
      ...SCALARS,
      'blocks',
      'blocks',
      ...(context.blockTypeIds.length ? ['block'] : []),
      ...(context.templateIds.length ? ['template'] : []),
    ];
    const list = buildFields(count(fields[0], fields[1]), full, allowed);
    // Every document type gets a block list of its own, whatever the sampling did: the
    // page builder is the thing most worth having something in.
    if (!list.some((field) => field.type === 'blocks') && context.blockTypeIds.length) {
      const builder = BUILDERS.blocks as FieldBuilder;
      const used = new Set(list.map((field) => field.name));
      list.push(builder(freeName('sections', used), full));
    }

    const name = freeName(TYPE_NAMES[index % TYPE_NAMES.length] ?? 'document', taken);
    built.push(
      await contentTypes.create(
        {
          name,
          description: sentence(10),
          spaceId,
          icon: pick([
            'i-lucide-file-text',
            'i-lucide-newspaper',
            'i-lucide-package',
            'i-lucide-calendar',
            'i-lucide-user',
          ]),
          hasSlug: true,
          isPublishable: true,
          isVisibleInTree: true,
          canBeVisibleInMenu: true,
          // A fifth of the model waits for a second pair of eyes, so the approval queue
          // has something in it.
          requiresApproval: chance(0.2),
          fields: list,
        },
        createdBy,
      ),
    );
  }
  return built;
}
