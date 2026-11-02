import type { ContentTypeDefinition, FieldDefinition } from '@manablox/core';
import { defaultMenuDesign } from './defaults.js';
import { designRoots, walkNodes } from './tree.js';
import type {
  BindingFormat,
  BlockDesign,
  DesignNode,
  LayoutDesign,
  LocalizedText,
  MenuDesign,
  PageDesign,
} from './types.js';
import { isRecord, shortHash } from './util.js';

/** What the generators read of a content type. */
export type DesignSourceType = Pick<ContentTypeDefinition, 'fields'> &
  Partial<Pick<ContentTypeDefinition, 'id' | 'label'>>;

type SourceField = Pick<FieldDefinition, 'id' | 'name' | 'type' | 'settings' | 'required'> &
  Partial<Pick<FieldDefinition, 'label' | 'admin'>>;

/** The fields of a repeater item; ids fall back to the machine name, as in the fields package. */
export function subFieldsOf(field: Pick<FieldDefinition, 'settings'>): SourceField[] {
  const raw =
    isRecord(field.settings) && Array.isArray(field.settings.fields) ? field.settings.fields : [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> & { name: string; type: string } =>
        isRecord(entry) && typeof entry.name === 'string' && typeof entry.type === 'string',
    )
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : entry.name,
      name: entry.name,
      label: typeof entry.label === 'string' ? entry.label : entry.name,
      type: entry.type,
      settings: isRecord(entry.settings) ? entry.settings : {},
      required: entry.required === true,
    }));
}

/** Main zone first, then by position; the order an editor sees them in. */
function ordered<T extends SourceField>(fields: readonly T[]): T[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => {
      const zone =
        (a.field.admin?.zone === 'sidebar' ? 1 : 0) - (b.field.admin?.zone === 'sidebar' ? 1 : 0);
      if (zone !== 0) return zone;
      const position = (a.field.admin?.position ?? a.index) - (b.field.admin?.position ?? b.index);
      return position !== 0 ? position : a.index - b.index;
    })
    .map((entry) => entry.field);
}

class Ids {
  readonly taken: Set<string>;

  constructor(taken: Iterable<string> = []) {
    this.taken = new Set(taken);
  }

  /** `base`, or `base-2`, `base-3`, ... when taken. */
  next(base: string): string {
    let id = base;
    for (let n = 2; this.taken.has(id); n++) id = `${base}-${n}`;
    this.taken.add(id);
    return id;
  }

  forField(path: string, name: string): string {
    const slug = name
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    return this.next(slug && /^[a-zA-Z]/.test(slug) ? `f-${slug}` : `f${shortHash(path)}`);
  }
}

interface FieldContext {
  ids: Ids;
  /** A heading is still free for the first string field. */
  heading: boolean;
  headingLevel: number;
  /** The first link field becomes a button. */
  button: boolean;
  depth: number;
}

function listOf(field: SourceField): boolean {
  return isRecord(field.settings) && field.settings.multiple === true;
}

function acceptOf(field: SourceField): string[] {
  const accept = isRecord(field.settings) ? field.settings.accept : undefined;
  return Array.isArray(accept)
    ? accept.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function formatFor(field: SourceField): BindingFormat | undefined {
  const settings = isRecord(field.settings) ? field.settings : {};
  switch (field.type) {
    case 'number':
      return /year/i.test(field.name) ? { type: 'number', grouping: false } : { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return settings.mode === 'date'
        ? { type: 'date', style: 'long' }
        : { type: 'date', style: 'long', time: true };
    case 'select':
      return settings.multiple === true ? { type: 'list' } : undefined;
    default:
      return undefined;
  }
}

/** Wraps a list-valued field in a `repeat` whose child shows one entry. */
function repeatList(
  path: string,
  field: SourceField,
  context: FieldContext,
  child: (bindPath: string) => DesignNode,
  grid: boolean,
): DesignNode {
  const repeatId = context.ids.forField(path, `${field.name}-list`);
  return {
    id: repeatId,
    el: 'repeat',
    bind: { field: path },
    style: {
      base: grid ? { display: 'grid', columns: 3, gap: 'space:4' } : { gap: 'space:2' },
      ...(grid ? { mobile: { columns: 1 } } : {}),
    },
    children: [child(`${path}.$item`)],
  };
}

function fieldNode(field: SourceField, path: string, context: FieldContext): DesignNode | null {
  const id = () => context.ids.forField(path, field.name);
  const settings = isRecord(field.settings) ? field.settings : {};
  switch (field.type) {
    case 'string': {
      if (settings.editor === 'code') {
        return {
          id: id(),
          el: 'text',
          bind: { field: path },
          props: { as: 'pre' },
          style: { base: { font: 'font:mono', type: 'type:sm' } },
        };
      }
      if (context.heading && settings.editor !== 'textarea') {
        context.heading = false;
        return {
          id: id(),
          el: 'heading',
          bind: { field: path },
          props: { level: context.headingLevel },
        };
      }
      return { id: id(), el: 'text', bind: { field: path } };
    }
    case 'richtext':
      return { id: id(), el: 'richtext', bind: { field: path } };
    case 'number':
    case 'boolean':
    case 'date':
    case 'select': {
      const format = formatFor(field);
      return { id: id(), el: 'text', bind: format ? { field: path, format } : { field: path } };
    }
    case 'asset': {
      const accept = acceptOf(field);
      const video = accept.length > 0 && accept.every((entry) => entry.startsWith('video/'));
      const image = accept.length === 0 || accept.some((entry) => entry.startsWith('image/'));
      const make = (bindPath: string): DesignNode =>
        video
          ? { id: id(), el: 'video', bind: { field: bindPath } }
          : image
            ? {
                id: id(),
                el: 'image',
                bind: { field: bindPath },
                style: { base: { width: '100%', radius: 'radius:md' } },
              }
            : { id: id(), el: 'link', bind: { field: bindPath } };
      return listOf(field) ? repeatList(path, field, context, make, image && !video) : make(path);
    }
    case 'link': {
      if (context.button) {
        context.button = false;
        return {
          id: id(),
          el: 'button',
          bind: { field: path },
          props: { variant: 'primary' },
          style: { base: { alignSelf: 'start' } },
        };
      }
      return { id: id(), el: 'link', bind: { field: path } };
    }
    case 'content': {
      const make = (bindPath: string): DesignNode => ({
        id: id(),
        el: 'link',
        bind: { field: bindPath },
      });
      return listOf(field) ? repeatList(path, field, context, make, false) : make(path);
    }
    case 'user': {
      const make = (bindPath: string): DesignNode => ({
        id: id(),
        el: 'text',
        bind: { field: bindPath },
      });
      return listOf(field) ? repeatList(path, field, context, make, false) : make(path);
    }
    case 'blocks':
      return { id: id(), el: 'blocks', bind: { field: path } };
    case 'block':
      return { id: id(), el: 'block', bind: { field: path } };
    case 'template':
      return { id: id(), el: 'template', bind: { field: path } };
    case 'databag':
      return boundFormNodes(path, id(), context.ids);
    case 'repeater': {
      if (context.depth >= 3) return null;
      const repeatId = id();
      const itemContext: FieldContext = {
        ids: context.ids,
        heading: true,
        headingLevel: Math.min(context.headingLevel + 1, 6),
        button: false,
        depth: context.depth + 1,
      };
      const children = fieldNodes(subFieldsOf(field), path, itemContext);
      return {
        id: repeatId,
        el: 'repeat',
        bind: { field: path },
        style: { base: { gap: 'space:4' } },
        children: [
          {
            id: context.ids.next(`${repeatId}-item`),
            el: 'stack',
            style: { base: { gap: 'space:2' } },
            children,
          },
        ],
      };
    }
    default:
      return { id: id(), el: 'text', bind: { field: path } };
  }
}

function fieldNodes(
  fields: readonly SourceField[],
  prefix: string,
  context: FieldContext,
): DesignNode[] {
  return ordered(fields)
    .map((field) => fieldNode(field, prefix ? `${prefix}.${field.id}` : field.id, context))
    .filter((node): node is DesignNode => node !== null);
}

/** A block design showing every field, top to bottom. */
export function generateBlockDesign(type: DesignSourceType): BlockDesign {
  const ids = new Ids(['root']);
  const children = fieldNodes(type.fields, '', {
    ids,
    heading: true,
    headingLevel: 2,
    button: true,
    depth: 0,
  });
  return {
    variants: {
      default: {
        label: 'Default',
        root: { id: 'root', el: 'stack', style: { base: { gap: 'space:4' } }, children },
      },
    },
    default: 'default',
  };
}

/** A page design: the title as the main heading, then every field, in a container. */
export function generatePageDesign(type: DesignSourceType): PageDesign {
  const ids = new Ids(['root', 'main', 'content', 'title']);
  const children = fieldNodes(type.fields, '', {
    ids,
    heading: false,
    headingLevel: 2,
    button: true,
    depth: 0,
  });
  return {
    root: {
      id: 'root',
      el: 'stack',
      children: [
        {
          id: 'main',
          el: 'section',
          style: { base: { paddingY: 'space:12' }, mobile: { paddingY: 'space:8' } },
          children: [
            {
              id: 'content',
              el: 'stack',
              style: { base: { gap: 'space:6' } },
              children: [
                { id: 'title', el: 'heading', bind: { field: '$title' }, props: { level: 1 } },
                ...children,
              ],
            },
          ],
        },
      ],
    },
  };
}

export interface MenuRef {
  machineName: string;
  name?: string;
}

const MAIN_MENU_NAMES = ['main', 'primary', 'header', 'navigation', 'nav'];

/** The header menu: a conventional name, else the first menu that is not a footer menu. */
function pickMainMenu(menus: readonly MenuRef[]): MenuRef | undefined {
  return (
    menus.find((menu) => MAIN_MENU_NAMES.includes(menu.machineName.toLowerCase())) ??
    menus.find((menu) => !/footer/i.test(menu.machineName))
  );
}

/**
 * The `default` layout: a header with logo and main menu, the page, and a footer with the
 * footer menu and the site name.
 */
export function generateLayout(
  space: { name: string; defaultLocale?: string },
  menus: readonly MenuRef[] = [],
): LayoutDesign {
  const main = pickMainMenu(menus);
  const footer = menus.find((menu) => menu !== main && /footer/i.test(menu.machineName));
  const siteName: LocalizedText = { [space.defaultLocale ?? 'en']: space.name };

  const header: DesignNode[] = [{ id: 'logo', el: 'logo', props: { link: true } }];
  if (main) header.push({ id: 'main-menu', el: 'menu', props: { menu: main.machineName } });

  const footerChildren: DesignNode[] = [];
  if (footer)
    footerChildren.push({ id: 'footer-menu', el: 'menu', props: { menu: footer.machineName } });
  footerChildren.push({
    id: 'site-name',
    el: 'text',
    bind: { field: '$site.name' },
    props: { text: siteName },
    style: { base: { color: 'color:muted', type: 'type:sm' } },
  });

  return {
    root: {
      id: 'root',
      el: 'stack',
      style: { base: { minHeight: '100vh' } },
      children: [
        {
          id: 'header',
          el: 'section',
          style: { base: { paddingY: 'space:4', background: 'color:bg' } },
          children: [
            {
              id: 'header-bar',
              el: 'stack',
              style: {
                base: { direction: 'row', align: 'center', justify: 'between', gap: 'space:6' },
              },
              children: header,
            },
          ],
        },
        {
          id: 'body',
          el: 'box',
          style: { base: { grow: true } },
          children: [{ id: 'slot', el: 'slot' }],
        },
        {
          id: 'footer',
          el: 'section',
          style: { base: { paddingY: 'space:10', background: 'color:surface' } },
          children: [
            {
              id: 'footer-content',
              el: 'stack',
              style: { base: { gap: 'space:6' } },
              children: footerChildren,
            },
          ],
        },
      ],
    },
  };
}

/** A menu design for a menu: footer columns for footer menus, a dropdown bar otherwise. */
export function generateMenuDesign(menu: MenuRef): MenuDesign {
  return defaultMenuDesign(/footer/i.test(menu.machineName) ? 'footer' : 'main');
}

const FORM_INPUTS: Record<string, (field: SourceField) => string | null> = {
  string: (field) => {
    const settings = isRecord(field.settings) ? field.settings : {};
    if (settings.editor === 'code') return null;
    if (
      /e-?mail/i.test(field.name) ||
      (typeof settings.pattern === 'string' && settings.pattern.includes('@'))
    )
      return 'email';
    return settings.editor === 'textarea' ? 'textarea' : 'text';
  },
  number: () => 'number',
  boolean: () => 'checkbox',
  select: () => 'select',
  date: (field) =>
    isRecord(field.settings) && field.settings.mode === 'date' ? 'date' : 'datetime',
};

/** Whether a data type's field can be filled in a site form. */
export function isFormField(field: SourceField): boolean {
  return (FORM_INPUTS[field.type]?.(field) ?? null) !== null;
}

/**
 * A `form` for a data type: one input per supported field, a submit button and the
 * success message. Ids avoid those in `taken`.
 */
export function generateFormNodes(
  type: Pick<ContentTypeDefinition, 'id' | 'fields'>,
  options: { taken?: Iterable<string>; locale?: string } = {},
): DesignNode {
  const ids = new Ids(options.taken);
  const locale = options.locale ?? 'en';
  // Fixed parts first, so no field id can take theirs.
  const formId = ids.next('form');
  const submitId = ids.next(`${formId}-submit`);
  const messageId = ids.next(`${formId}-message`);
  const fields: DesignNode[] = [];
  for (const field of ordered(type.fields)) {
    const input = FORM_INPUTS[field.type]?.(field) ?? null;
    if (!input) continue;
    fields.push({
      id: ids.forField(field.id, field.name),
      el: 'formField',
      props: { fieldId: field.id, input, label: { [locale]: field.label ?? field.name } },
    });
  }
  return {
    id: formId,
    el: 'form',
    props: { databagTypeId: type.id, successMessage: { [locale]: 'Thank you!' } },
    style: { base: { gap: 'space:4' } },
    children: [
      ...fields,
      {
        id: submitId,
        el: 'formSubmit',
        props: { text: { [locale]: 'Send' } },
        style: { base: { alignSelf: 'start' } },
      },
      { id: messageId, el: 'formMessage' },
    ],
  };
}

/**
 * A `form` bound to a databag field: its one input repeats for every field of the databag
 * type an editor picks.
 */
function boundFormNodes(path: string, formId: string, ids: Ids): DesignNode {
  return {
    id: formId,
    el: 'form',
    bind: { field: path },
    style: { base: { gap: 'space:4' } },
    children: [
      { id: ids.next(`${formId}-input`), el: 'formField' },
      {
        id: ids.next(`${formId}-submit`),
        el: 'formSubmit',
        style: { base: { alignSelf: 'start' } },
      },
      { id: ids.next(`${formId}-message`), el: 'formMessage' },
    ],
  };
}

function designTrees(design: BlockDesign | PageDesign): DesignNode[] {
  return designRoots('variants' in design ? 'block' : 'page', design);
}

/** Every field path a design reads: bindings and `whenField` conditions. */
function boundPaths(design: BlockDesign | PageDesign): Array<{ nodeId: string; path: string }> {
  const out: Array<{ nodeId: string; path: string }> = [];
  for (const root of designTrees(design)) {
    walkNodes(root, ({ node }) => {
      if (typeof node.bind?.field === 'string')
        out.push({ nodeId: node.id, path: node.bind.field });
      if (typeof node.visibility?.whenField === 'string')
        out.push({ nodeId: node.id, path: node.visibility.whenField });
    });
  }
  return out;
}

/** Top-level fields of the type that no element shows. */
export function findUnplacedFields<F extends SourceField>(
  design: BlockDesign | PageDesign,
  type: { fields: readonly F[] },
): F[] {
  const placed = new Set<string>();
  for (const root of designTrees(design)) {
    walkNodes(root, ({ node }) => {
      const field = node.bind?.field;
      if (typeof field === 'string' && !field.startsWith('$'))
        placed.add(field.split('.')[0] as string);
    });
  }
  return type.fields.filter((field) => !placed.has(field.id));
}

export interface BrokenBinding {
  nodeId: string;
  /** The binding or condition that points nowhere. */
  field: string;
}

/** Bindings and conditions whose field, or repeater sub-field, is gone from the type. */
export function findBrokenBindings(
  design: BlockDesign | PageDesign,
  type: { fields: readonly SourceField[] },
): BrokenBinding[] {
  const broken: BrokenBinding[] = [];
  for (const { nodeId, path } of boundPaths(design)) {
    if (path.startsWith('$')) continue;
    let fields: readonly SourceField[] = type.fields;
    let ok = true;
    const segments = path.split('.');
    for (const [index, segment] of segments.entries()) {
      if (segment === '$item' && index > 0) break;
      const field = fields.find((entry) => entry.id === segment);
      if (!field) {
        ok = false;
        break;
      }
      // Fields of related documents are known only when rendering.
      if (field.type === 'content') break;
      fields = field.type === 'repeater' ? subFieldsOf(field) : [];
    }
    if (!ok) broken.push({ nodeId, field: path });
  }
  return broken;
}
