import { isSafeHref } from '@manablox/core';
import type { BlockInstanceDesign } from './block-design.js';
import {
  BUTTON_VARIANTS,
  canContain,
  canPlace,
  ELEMENTS,
  EMBED_PROVIDERS,
  isElementKind,
} from './elements.js';
import {
  BUNDLED_PATH,
  COLOR,
  FONT_FALLBACK,
  FONT_NAME,
  FONT_WEIGHT,
  SHADOW,
  WEIGHTS,
} from './patterns.js';
import { isSize, parseTokenRef, stylePropsIssues, styleRulesIssues, TOKEN_NAME } from './style.js';
import { NODE_ID } from './tree.js';
import {
  COLOR_ROLES,
  type DesignNode,
  type ElementKind,
  type InstanceStyle,
  SITE_DESIGN_KINDS,
  type SiteDesignData,
  type SiteDesignKind,
  type SiteIssue,
  type SiteValidationResult,
  TYPE_STEPS,
} from './types.js';
import { cssBracesBalanced, isRecord } from './util.js';

/** Deepest allowed node nesting; the root is depth 0. */
export const MAX_DESIGN_DEPTH = 24;
/** Nodes per design, across all variants. */
export const MAX_DESIGN_NODES = 2000;
/** Serialised size of one design. */
export const MAX_DESIGN_BYTES = 512 * 1024;
export const MAX_CUSTOM_CSS = 200 * 1024;
export const MAX_CODE_SNIPPET = 100 * 1024;
export const MAX_VARIANTS = 20;
export const MAX_MENU_DEPTH = 3;

const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const LOCALE = /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8}){0,3}$/;
const FIELD_SEGMENT = /^[a-zA-Z0-9_-]{1,64}$/;
const DESIGN_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DOCUMENT_META = ['$title', '$permalink', '$publishedAt', '$author'];
const SITE_META = ['$site.name', '$site.logo'];

class Issues {
  readonly list: SiteIssue[] = [];

  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
}

const join = (path: string, key: string | number): string =>
  path ? `${path}.${key}` : String(key);

function onlyKeys(
  issues: Issues,
  path: string,
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined && !keys.includes(key))
      issues.add(join(path, key), 'is not allowed');
  }
}

function checkString(
  issues: Issues,
  path: string,
  value: unknown,
  max: number,
  required = true,
): boolean {
  if (value === undefined && !required) return true;
  if (typeof value !== 'string') {
    issues.add(path, 'must be a string');
    return false;
  }
  if (value.length > max) {
    issues.add(path, `must be at most ${max} characters`);
    return false;
  }
  return true;
}

function checkLocalizedText(issues: Issues, path: string, value: unknown): void {
  if (!isRecord(value)) {
    issues.add(path, 'must be text per locale, like { "en": "..." }');
    return;
  }
  for (const [locale, text] of Object.entries(value)) {
    if (!LOCALE.test(locale)) issues.add(join(path, locale), 'is not a locale code');
    else checkString(issues, join(path, locale), text, 10_000);
  }
}

function checkStyleRules(issues: Issues, path: string, value: unknown): void {
  if (value === undefined) return;
  for (const [key, message] of styleRulesIssues(value))
    issues.add(key ? join(path, key) : path, message);
}

function checkStyleProps(issues: Issues, path: string, value: unknown): void {
  if (value === undefined) return;
  for (const [key, message] of stylePropsIssues(value))
    issues.add(key ? join(path, key) : path, message);
}

function checkSize(issues: Issues, path: string, value: unknown, required = true): void {
  if (value === undefined && !required) return;
  if (!isSize(value)) issues.add(path, 'must be a size with a unit, like 1rem');
}

function checkEnum(
  issues: Issues,
  path: string,
  value: unknown,
  values: readonly unknown[],
  required = true,
): void {
  if (value === undefined && !required) return;
  if (!values.includes(value)) issues.add(path, `must be one of ${values.join(', ')}`);
}

function checkTokenRef(
  issues: Issues,
  path: string,
  value: unknown,
  group: string,
  required = true,
): void {
  if (value === undefined && !required) return;
  const ref = parseTokenRef(value);
  if (ref?.group !== group) issues.add(path, `must be a ${group} token, like ${group}:name`);
}

function checkTooLarge(issues: Issues, value: unknown, max: number): boolean {
  let size: number;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    issues.add('', 'must be plain JSON');
    return true;
  }
  if (size > max) {
    issues.add('', `is too large (${size} bytes, at most ${max})`);
    return true;
  }
  return false;
}

// Element trees

interface TreeContext {
  kind: SiteDesignKind;
  issues: Issues;
  ids: Set<string>;
  nodes: number;
  slots: number;
}

interface Scope {
  ancestors: ElementKind[];
  /** Fields bound by enclosing `repeat` elements. */
  repeats: string[];
  /** Field ids used by enclosing form fields. */
  formFields: Set<string> | null;
  /** The enclosing form takes its databag type from a field; its inputs name no field. */
  boundForm: boolean;
}

function checkFieldPath(context: TreeContext, path: string, field: unknown, scope: Scope): void {
  const { issues, kind } = context;
  if (typeof field !== 'string' || field === '') {
    issues.add(path, 'must be a field id');
    return;
  }
  if (field.startsWith('$')) {
    const allowed =
      kind === 'layout' ? [...DOCUMENT_META, ...SITE_META] : kind === 'page' ? DOCUMENT_META : [];
    if (!allowed.includes(field)) {
      issues.add(
        path,
        allowed.length
          ? `must be a field id or one of ${allowed.join(', ')}`
          : 'must be a field id',
      );
    }
    return;
  }
  const segments = field.split('.');
  if (segments.length > 4) {
    issues.add(path, 'is nested too deep');
    return;
  }
  segments.forEach((segment, index) => {
    const valid =
      segment === '$item'
        ? index === segments.length - 1 && index > 0
        : FIELD_SEGMENT.test(segment);
    if (!valid) issues.add(path, `has an invalid segment "${segment}"`);
  });
  if (segments.length > 1) {
    const parent = segments.slice(0, -1).join('.');
    if (!scope.repeats.includes(parent))
      issues.add(path, `must be inside a repeat bound to ${parent}`);
  }
}

function checkBinding(context: TreeContext, path: string, bind: unknown, scope: Scope): void {
  const { issues } = context;
  if (!isRecord(bind)) {
    issues.add(path, 'must be an object with a field');
    return;
  }
  onlyKeys(issues, path, bind, ['field', 'format']);
  checkFieldPath(context, join(path, 'field'), bind.field, scope);
  if (bind.format === undefined) return;
  const format = bind.format;
  const formatPath = join(path, 'format');
  if (!isRecord(format)) {
    issues.add(formatPath, 'must be an object');
    return;
  }
  switch (format.type) {
    case 'date':
      onlyKeys(issues, formatPath, format, ['type', 'style', 'time']);
      checkEnum(
        issues,
        join(formatPath, 'style'),
        format.style,
        ['short', 'medium', 'long'],
        false,
      );
      if (format.time !== undefined && typeof format.time !== 'boolean')
        issues.add(join(formatPath, 'time'), 'must be a boolean');
      break;
    case 'number':
      onlyKeys(issues, formatPath, format, ['type', 'decimals', 'style', 'currency', 'grouping']);
      if (
        format.decimals !== undefined &&
        !(
          Number.isInteger(format.decimals) &&
          (format.decimals as number) >= 0 &&
          (format.decimals as number) <= 10
        )
      )
        issues.add(join(formatPath, 'decimals'), 'must be a whole number from 0 to 10');
      checkEnum(
        issues,
        join(formatPath, 'style'),
        format.style,
        ['decimal', 'percent', 'currency'],
        false,
      );
      if (
        format.currency !== undefined &&
        !(typeof format.currency === 'string' && /^[A-Z]{3}$/.test(format.currency))
      )
        issues.add(join(formatPath, 'currency'), 'must be a currency code like EUR');
      if (format.grouping !== undefined && typeof format.grouping !== 'boolean')
        issues.add(join(formatPath, 'grouping'), 'must be a boolean');
      break;
    case 'boolean':
      onlyKeys(issues, formatPath, format, ['type', 'trueText', 'falseText']);
      if (format.trueText !== undefined)
        checkLocalizedText(issues, join(formatPath, 'trueText'), format.trueText);
      if (format.falseText !== undefined)
        checkLocalizedText(issues, join(formatPath, 'falseText'), format.falseText);
      break;
    case 'list':
      onlyKeys(issues, formatPath, format, ['type', 'separator']);
      checkString(issues, join(formatPath, 'separator'), format.separator, 10, false);
      break;
    case 'excerpt':
      onlyKeys(issues, formatPath, format, ['type', 'length']);
      if (
        format.length !== undefined &&
        !(
          Number.isInteger(format.length) &&
          (format.length as number) > 0 &&
          (format.length as number) <= 5000
        )
      )
        issues.add(join(formatPath, 'length'), 'must be a whole number from 1 to 5000');
      break;
    default:
      issues.add(join(formatPath, 'type'), 'must be one of date, number, boolean, list, excerpt');
  }
}

function checkProps(context: TreeContext, path: string, node: DesignNode, scope: Scope): void {
  const { issues } = context;
  const props = node.props;
  const el = node.el;
  if (props === undefined) {
    if (el === 'form' && node.bind === undefined)
      issues.add(join(path, 'databagTypeId'), 'is required');
    if (el === 'formField' && !scope.boundForm) issues.add(join(path, 'fieldId'), 'is required');
    if (el === 'menu') issues.add(join(path, 'menu'), 'is required');
    return;
  }
  if (!isRecord(props)) {
    issues.add(path, 'must be an object');
    return;
  }
  for (const key of ELEMENTS[el].textProps ?? []) {
    if (props[key] !== undefined) checkLocalizedText(issues, join(path, key), props[key]);
  }
  const optionalString = (key: string, max = 200) =>
    checkString(issues, join(path, key), props[key], max, false);
  const requiredString = (key: string, max = 200) => {
    if (props[key] === undefined || props[key] === '') issues.add(join(path, key), 'is required');
    else checkString(issues, join(path, key), props[key], max);
  };
  switch (el) {
    case 'heading':
      if (
        props.level !== undefined &&
        !(
          Number.isInteger(props.level) &&
          (props.level as number) >= 1 &&
          (props.level as number) <= 6
        )
      )
        issues.add(join(path, 'level'), 'must be 1 to 6');
      break;
    case 'link':
    case 'button':
      if (props.href !== undefined && (typeof props.href !== 'string' || !isSafeHref(props.href)))
        issues.add(join(path, 'href'), 'must be an http(s), mailto, tel, relative or # address');
      checkEnum(issues, join(path, 'target'), props.target, ['_self', '_blank'], false);
      if (el === 'button')
        checkEnum(issues, join(path, 'variant'), props.variant, BUTTON_VARIANTS, false);
      break;
    case 'image':
    case 'video':
      optionalString('assetId');
      break;
    case 'section':
      if (
        props.container !== undefined &&
        !(typeof props.container === 'string' && TOKEN_NAME.test(props.container))
      )
        issues.add(join(path, 'container'), 'must be a container name');
      break;
    case 'icon':
      optionalString('name', 64);
      break;
    case 'embed':
      checkEnum(issues, join(path, 'provider'), props.provider, EMBED_PROVIDERS, false);
      if (
        props.url !== undefined &&
        !(
          typeof props.url === 'string' &&
          /^https:\/\//.test(props.url) &&
          props.url.length <= 2000
        )
      )
        issues.add(join(path, 'url'), 'must be an https address');
      break;
    case 'blocks':
      if (props.variant !== undefined) optionalString('variant', 64);
      break;
    case 'form':
      if (node.bind === undefined) requiredString('databagTypeId');
      else if (props.databagTypeId !== undefined)
        issues.add(
          join(path, 'databagTypeId'),
          'must be left out when the form is bound to a field',
        );
      optionalString('redirectContentId');
      if (props.consent !== undefined && typeof props.consent !== 'boolean')
        issues.add(join(path, 'consent'), 'must be a boolean');
      break;
    case 'formField': {
      if (!scope.boundForm) requiredString('fieldId', 64);
      else if (props.fieldId !== undefined)
        issues.add(join(path, 'fieldId'), 'must be left out in a form bound to a field');
      checkEnum(
        issues,
        join(path, 'input'),
        props.input,
        ['text', 'textarea', 'email', 'number', 'checkbox', 'select', 'date', 'datetime'],
        false,
      );
      if (typeof props.fieldId === 'string' && scope.formFields) {
        if (scope.formFields.has(props.fieldId))
          issues.add(join(path, 'fieldId'), 'is already used in this form');
        scope.formFields.add(props.fieldId);
      }
      break;
    }
    case 'menu':
      requiredString('menu', 64);
      optionalString('design', 64);
      break;
    case 'logo':
      checkEnum(issues, join(path, 'link'), props.link, [true, false], false);
      break;
  }
}

function checkNode(
  context: TreeContext,
  path: string,
  value: unknown,
  scope: Scope,
  depth: number,
): void {
  const { issues } = context;
  if (!isRecord(value)) {
    issues.add(path, 'must be an element');
    return;
  }
  context.nodes++;
  if (context.nodes === MAX_DESIGN_NODES + 1)
    issues.add(path, `a design holds at most ${MAX_DESIGN_NODES} elements`);
  if (depth > MAX_DESIGN_DEPTH) {
    issues.add(path, `is nested deeper than ${MAX_DESIGN_DEPTH} levels`);
    return;
  }
  onlyKeys(issues, path, value, ['id', 'el', 'bind', 'props', 'style', 'children', 'visibility']);

  if (typeof value.id !== 'string' || !NODE_ID.test(value.id)) {
    issues.add(
      join(path, 'id'),
      'must start with a letter and hold only letters, digits, - and _ (at most 40)',
    );
  } else if (context.ids.has(value.id)) {
    issues.add(join(path, 'id'), `"${value.id}" is used twice`);
  } else {
    context.ids.add(value.id);
  }

  if (!isElementKind(value.el)) {
    issues.add(join(path, 'el'), 'is not a known element');
    return;
  }
  const el = value.el;
  const node = value as unknown as DesignNode;
  const info = ELEMENTS[el];

  if (!canPlace(el, context.kind, scope.ancestors)) {
    let message = 'is not allowed here';
    if (info.category === 'chrome') message = 'is only allowed in layouts';
    else if (el === 'form') message = 'cannot be inside another form';
    else if (info.category === 'form') message = 'must be inside a form';
    issues.add(join(path, 'el'), message);
  }
  if (el === 'slot') context.slots++;

  if (value.bind !== undefined) checkBinding(context, join(path, 'bind'), value.bind, scope);
  else if (info.requiresBind) issues.add(join(path, 'bind'), 'is required');

  checkProps(context, join(path, 'props'), node, scope);
  checkStyleRules(issues, join(path, 'style'), value.style);

  if (value.visibility !== undefined) {
    const visibilityPath = join(path, 'visibility');
    const visibility = value.visibility;
    if (!isRecord(visibility)) issues.add(visibilityPath, 'must be an object');
    else {
      onlyKeys(issues, visibilityPath, visibility, ['breakpoints', 'whenField']);
      const breakpoints = visibility.breakpoints;
      if (breakpoints !== undefined) {
        if (
          !Array.isArray(breakpoints) ||
          breakpoints.some((entry) => !BREAKPOINTS.includes(entry)) ||
          new Set(breakpoints).size !== breakpoints.length
        )
          issues.add(
            join(visibilityPath, 'breakpoints'),
            'must list distinct breakpoints: desktop, tablet, mobile',
          );
      }
      if (visibility.whenField !== undefined)
        checkFieldPath(context, join(visibilityPath, 'whenField'), visibility.whenField, scope);
    }
  }

  if (value.children === undefined) return;
  const childrenPath = join(path, 'children');
  if (!Array.isArray(value.children)) {
    issues.add(childrenPath, 'must be a list');
    return;
  }
  if (!info.container && value.children.length > 0) {
    issues.add(childrenPath, `a ${el} element has no children`);
    return;
  }
  const bound =
    el === 'repeat' && isRecord(value.bind) && typeof value.bind.field === 'string'
      ? value.bind.field
      : null;
  const childScope: Scope = {
    ancestors: [...scope.ancestors, el],
    repeats: bound ? [...scope.repeats, bound] : scope.repeats,
    formFields: el === 'form' ? new Set() : scope.formFields,
    boundForm: el === 'form' ? value.bind !== undefined : scope.boundForm,
  };
  value.children.forEach((child, index) => {
    const childPath = join(childrenPath, index);
    if (isRecord(child) && isElementKind(child.el) && info.container && !canContain(el, child.el)) {
      issues.add(join(childPath, 'el'), `cannot be inside a ${el}`);
    }
    checkNode(context, childPath, child, childScope, depth + 1);
  });
}

function checkTree(context: TreeContext, path: string, root: unknown): void {
  checkNode(
    context,
    path,
    root,
    { ancestors: [], repeats: [], formFields: null, boundForm: false },
    0,
  );
}

// Designs

function validateBlock(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, ['variants', 'default']);
  const context: TreeContext = { kind: 'block', issues, ids: new Set(), nodes: 0, slots: 0 };
  const variants = data.variants;
  if (!isRecord(variants) || Object.keys(variants).length === 0) {
    issues.add('variants', 'needs at least one variant');
    return;
  }
  const names = Object.keys(variants).sort();
  if (names.length > MAX_VARIANTS) issues.add('variants', `at most ${MAX_VARIANTS} variants`);
  for (const name of names) {
    const path = join('variants', name);
    if (!DESIGN_KEY.test(name)) issues.add(path, 'variant names hold letters, digits, - and _');
    const variant = variants[name];
    if (!isRecord(variant)) {
      issues.add(path, 'must be an object with a label and a root');
      continue;
    }
    onlyKeys(issues, path, variant, ['label', 'root']);
    checkString(issues, join(path, 'label'), variant.label, 100);
    checkTree(context, join(path, 'root'), variant.root);
  }
  if (typeof data.default !== 'string' || !Object.hasOwn(variants, data.default))
    issues.add('default', 'must name one of the variants');
}

function validatePage(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, ['root', 'layout', 'seo']);
  if (
    data.layout !== undefined &&
    !(typeof data.layout === 'string' && DESIGN_KEY.test(data.layout))
  )
    issues.add('layout', 'must be a layout key');
  if (data.seo !== undefined) {
    if (!isRecord(data.seo)) issues.add('seo', 'must be an object');
    else {
      onlyKeys(issues, 'seo', data.seo, ['description', 'image']);
      for (const key of ['description', 'image'] as const) {
        const value = data.seo[key];
        if (value !== undefined && !(typeof value === 'string' && FIELD_SEGMENT.test(value)))
          issues.add(join('seo', key), 'must be a field id');
      }
    }
  }
  checkTree({ kind: 'page', issues, ids: new Set(), nodes: 0, slots: 0 }, 'root', data.root);
}

function validateLayout(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, ['root']);
  const context: TreeContext = { kind: 'layout', issues, ids: new Set(), nodes: 0, slots: 0 };
  checkTree(context, 'root', data.root);
  if (isRecord(data.root) && context.slots !== 1)
    issues.add('root', `a layout needs exactly one slot element (found ${context.slots})`);
}

function validateMenu(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, ['preset', 'depth', 'root', 'levels', 'mobile']);
  checkEnum(issues, 'preset', data.preset, ['bar', 'list', 'dropdown', 'mega', 'columns']);
  if (
    !(
      Number.isInteger(data.depth) &&
      (data.depth as number) >= 1 &&
      (data.depth as number) <= MAX_MENU_DEPTH
    )
  )
    issues.add('depth', `must be 1 to ${MAX_MENU_DEPTH}`);
  checkStyleRules(issues, 'root', data.root);
  if (!Array.isArray(data.levels) || data.levels.length > MAX_MENU_DEPTH) {
    issues.add('levels', `must be a list of at most ${MAX_MENU_DEPTH} level styles`);
  } else {
    data.levels.forEach((level, index) => {
      const path = join('levels', index);
      if (!isRecord(level)) {
        issues.add(path, 'must be an object');
        return;
      }
      onlyKeys(issues, path, level, ['list', 'item', 'link', 'current']);
      checkStyleRules(issues, join(path, 'list'), level.list);
      checkStyleRules(issues, join(path, 'item'), level.item);
      checkStyleRules(issues, join(path, 'link'), level.link);
      checkStyleProps(issues, join(path, 'current'), level.current);
    });
  }
  const mobile = data.mobile;
  if (!isRecord(mobile)) {
    issues.add('mobile', 'must be an object');
    return;
  }
  onlyKeys(issues, 'mobile', mobile, ['behaviour', 'breakpoint', 'label', 'toggle', 'panel']);
  checkEnum(issues, 'mobile.behaviour', mobile.behaviour, ['none', 'burger', 'offcanvas']);
  checkEnum(issues, 'mobile.breakpoint', mobile.breakpoint, ['tablet', 'mobile']);
  if (mobile.label !== undefined) checkLocalizedText(issues, 'mobile.label', mobile.label);
  checkStyleRules(issues, 'mobile.toggle', mobile.toggle);
  checkStyleRules(issues, 'mobile.panel', mobile.panel);
}

function checkColor(
  issues: Issues,
  path: string,
  value: unknown,
  palette: Record<string, unknown>,
): void {
  if (typeof value === 'string' && (COLOR.test(value) || Object.hasOwn(palette, value))) return;
  issues.add(path, 'must be a CSS color or a palette name');
}

function checkTextDefaults(issues: Issues, path: string, value: unknown): void {
  if (!isRecord(value)) {
    issues.add(path, 'must be an object');
    return;
  }
  onlyKeys(issues, path, value, ['type', 'font', 'weight', 'color', 'textTransform']);
  checkEnum(issues, join(path, 'type'), value.type, TYPE_STEPS);
  checkEnum(issues, join(path, 'font'), value.font, ['body', 'heading', 'mono']);
  checkEnum(issues, join(path, 'weight'), value.weight, WEIGHTS, false);
  checkTokenRef(issues, join(path, 'color'), value.color, 'color', false);
  checkEnum(
    issues,
    join(path, 'textTransform'),
    value.textTransform,
    ['none', 'uppercase', 'lowercase', 'capitalize'],
    false,
  );
}

function checkTokenRecord(
  issues: Issues,
  path: string,
  value: unknown,
  check: (path: string, entry: unknown) => void,
): void {
  if (!isRecord(value)) {
    issues.add(path, 'must be an object');
    return;
  }
  for (const [name, entry] of Object.entries(value)) {
    if (!TOKEN_NAME.test(name))
      issues.add(join(path, name), 'token names hold letters, digits and -');
    check(join(path, name), entry);
  }
}

function validateTheme(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, [
    'colors',
    'fonts',
    'type',
    'headings',
    'body',
    'space',
    'radius',
    'shadow',
    'container',
    'elements',
  ]);

  const colors = data.colors;
  if (!isRecord(colors)) issues.add('colors', 'must be an object');
  else {
    onlyKeys(issues, 'colors', colors, ['palette', 'roles', 'dark']);
    const palette = isRecord(colors.palette) ? colors.palette : {};
    checkTokenRecord(issues, 'colors.palette', colors.palette, (path, entry) => {
      if (typeof entry !== 'string' || !COLOR.test(entry)) issues.add(path, 'must be a CSS color');
    });
    for (const name of Object.keys(palette)) {
      if ((COLOR_ROLES as readonly string[]).includes(name))
        issues.add(join('colors.palette', name), 'must not share a name with a color role');
    }
    const roles = colors.roles;
    if (!isRecord(roles)) issues.add('colors.roles', 'must be an object');
    else {
      onlyKeys(issues, 'colors.roles', roles, COLOR_ROLES);
      for (const role of COLOR_ROLES)
        checkColor(issues, join('colors.roles', role), roles[role], palette);
    }
    if (colors.dark !== undefined) {
      if (!isRecord(colors.dark)) issues.add('colors.dark', 'must be an object');
      else {
        onlyKeys(issues, 'colors.dark', colors.dark, COLOR_ROLES);
        for (const [role, entry] of Object.entries(colors.dark)) {
          if (entry !== undefined) checkColor(issues, join('colors.dark', role), entry, palette);
        }
      }
    }
  }

  const fonts = data.fonts;
  if (!isRecord(fonts)) issues.add('fonts', 'must be an object');
  else {
    onlyKeys(issues, 'fonts', fonts, ['families', 'roles']);
    const ids = new Set<string>();
    if (!Array.isArray(fonts.families)) issues.add('fonts.families', 'must be a list');
    else {
      fonts.families.forEach((family, index) => {
        const path = join('fonts.families', index);
        if (!isRecord(family)) {
          issues.add(path, 'must be an object');
          return;
        }
        onlyKeys(issues, path, family, ['id', 'name', 'source', 'files', 'fallback']);
        if (typeof family.id !== 'string' || !TOKEN_NAME.test(family.id))
          issues.add(join(path, 'id'), 'must be a token name');
        else if (['body', 'heading', 'mono'].includes(family.id))
          issues.add(join(path, 'id'), 'must not be body, heading or mono');
        else if (ids.has(family.id)) issues.add(join(path, 'id'), `"${family.id}" is used twice`);
        else ids.add(family.id);
        if (typeof family.name !== 'string' || !FONT_NAME.test(family.name))
          issues.add(join(path, 'name'), 'must be a font name of letters, digits, spaces, - and _');
        checkEnum(issues, join(path, 'source'), family.source, ['bundled', 'asset', 'google']);
        if (typeof family.fallback !== 'string' || !FONT_FALLBACK.test(family.fallback))
          issues.add(join(path, 'fallback'), 'must be a font list');
        if (!Array.isArray(family.files)) issues.add(join(path, 'files'), 'must be a list');
        else {
          family.files.forEach((file, fileIndex) => {
            const filePath = join(join(path, 'files'), fileIndex);
            if (!isRecord(file)) {
              issues.add(filePath, 'must be an object');
              return;
            }
            onlyKeys(issues, filePath, file, ['assetId', 'bundledPath', 'weight', 'style']);
            if (family.source === 'bundled') {
              if (typeof file.bundledPath !== 'string' || !BUNDLED_PATH.test(file.bundledPath))
                issues.add(join(filePath, 'bundledPath'), 'must be a relative font path');
            } else if (typeof file.assetId !== 'string' || file.assetId === '') {
              issues.add(join(filePath, 'assetId'), 'is required');
            }
            const weight = file.weight;
            if (
              !(
                WEIGHTS.includes(weight as number) ||
                (typeof weight === 'string' && FONT_WEIGHT.test(weight))
              )
            )
              issues.add(
                join(filePath, 'weight'),
                'must be a weight like 400 or a range like "100 900"',
              );
            checkEnum(issues, join(filePath, 'style'), file.style, ['normal', 'italic']);
          });
        }
      });
    }
    const roles = fonts.roles;
    if (!isRecord(roles)) issues.add('fonts.roles', 'must be an object');
    else {
      onlyKeys(issues, 'fonts.roles', roles, ['body', 'heading', 'mono']);
      for (const role of ['body', 'heading', 'mono']) {
        if (typeof roles[role] !== 'string' || !ids.has(roles[role]))
          issues.add(join('fonts.roles', role), 'must name a font family');
      }
    }
  }

  const type = data.type;
  if (!isRecord(type)) issues.add('type', 'must be an object');
  else {
    onlyKeys(issues, 'type', type, TYPE_STEPS);
    for (const step of TYPE_STEPS) {
      const path = join('type', step);
      const entry = type[step];
      if (!isRecord(entry)) {
        issues.add(path, 'is required');
        continue;
      }
      onlyKeys(issues, path, entry, [
        'size',
        'mobileSize',
        'lineHeight',
        'weight',
        'letterSpacing',
      ]);
      checkSize(issues, join(path, 'size'), entry.size);
      checkSize(issues, join(path, 'mobileSize'), entry.mobileSize, false);
      if (
        !(typeof entry.lineHeight === 'number' && entry.lineHeight >= 0.5 && entry.lineHeight <= 3)
      )
        issues.add(join(path, 'lineHeight'), 'must be a number from 0.5 to 3');
      checkEnum(issues, join(path, 'weight'), entry.weight, WEIGHTS);
      checkSize(issues, join(path, 'letterSpacing'), entry.letterSpacing, false);
    }
  }

  const headings = data.headings;
  if (!isRecord(headings)) issues.add('headings', 'must be an object');
  else {
    const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    onlyKeys(issues, 'headings', headings, levels);
    for (const level of levels) checkTextDefaults(issues, join('headings', level), headings[level]);
  }
  checkTextDefaults(issues, 'body', data.body);

  checkTokenRecord(issues, 'space', data.space, (path, entry) => checkSize(issues, path, entry));
  checkTokenRecord(issues, 'radius', data.radius, (path, entry) => checkSize(issues, path, entry));
  checkTokenRecord(issues, 'shadow', data.shadow, (path, entry) => {
    if (typeof entry !== 'string' || !SHADOW.test(entry))
      issues.add(path, 'must be a CSS box shadow');
  });

  const container = data.container;
  if (!isRecord(container)) issues.add('container', 'must be an object');
  else {
    onlyKeys(issues, 'container', container, ['widths', 'default', 'gutter']);
    checkTokenRecord(issues, 'container.widths', container.widths, (path, entry) =>
      checkSize(issues, path, entry),
    );
    if (
      typeof container.default !== 'string' ||
      !isRecord(container.widths) ||
      !Object.hasOwn(container.widths, container.default)
    )
      issues.add('container.default', 'must name one of the widths');
    checkTokenRef(issues, 'container.gutter', container.gutter, 'space');
  }

  const elements = data.elements;
  if (!isRecord(elements)) issues.add('elements', 'must be an object');
  else {
    onlyKeys(issues, 'elements', elements, [
      'body',
      'link',
      'button',
      'buttons',
      'input',
      'label',
      'prose',
    ]);
    for (const key of ['body', 'link', 'button', 'input', 'label', 'prose'])
      checkStyleRules(issues, join('elements', key), elements[key]);
    const buttons = elements.buttons;
    if (buttons !== undefined) {
      if (!isRecord(buttons)) issues.add('elements.buttons', 'must be an object');
      else {
        onlyKeys(issues, 'elements.buttons', buttons, BUTTON_VARIANTS);
        for (const variant of BUTTON_VARIANTS)
          checkStyleRules(issues, join('elements.buttons', variant), buttons[variant]);
      }
    }
  }
}

function validateSite(issues: Issues, data: Record<string, unknown>): void {
  onlyKeys(issues, '', data, [
    'name',
    'logo',
    'favicon',
    'titlePattern',
    'meta',
    'robots',
    'customCss',
    'headCode',
    'bodyEndCode',
    'layouts',
  ]);
  checkString(issues, 'name', data.name, 200);
  if (data.logo !== undefined && data.logo !== null) {
    if (!isRecord(data.logo)) issues.add('logo', 'must be an object with an assetId');
    else {
      onlyKeys(issues, 'logo', data.logo, ['assetId', 'alt']);
      if (typeof data.logo.assetId !== 'string' || data.logo.assetId === '')
        issues.add('logo.assetId', 'is required');
      if (data.logo.alt !== undefined) checkLocalizedText(issues, 'logo.alt', data.logo.alt);
    }
  }
  if (data.favicon !== undefined && data.favicon !== null)
    checkString(issues, 'favicon', data.favicon, 200);
  checkString(issues, 'titlePattern', data.titlePattern, 200);

  if (!isRecord(data.meta)) issues.add('meta', 'must be an object');
  else {
    onlyKeys(issues, 'meta', data.meta, ['description', 'ogImage']);
    if (data.meta.description !== undefined)
      checkLocalizedText(issues, 'meta.description', data.meta.description);
    if (data.meta.ogImage !== undefined && data.meta.ogImage !== null)
      checkString(issues, 'meta.ogImage', data.meta.ogImage, 200);
  }

  if (!isRecord(data.robots)) issues.add('robots', 'must be an object');
  else {
    onlyKeys(issues, 'robots', data.robots, ['index', 'extra']);
    if (typeof data.robots.index !== 'boolean') issues.add('robots.index', 'must be a boolean');
    checkString(issues, 'robots.extra', data.robots.extra, 10_000, false);
  }

  if (
    checkString(issues, 'customCss', data.customCss, MAX_CUSTOM_CSS, false) &&
    typeof data.customCss === 'string'
  ) {
    if (!cssBracesBalanced(data.customCss)) issues.add('customCss', 'has unbalanced braces');
    if (/<\/style/i.test(data.customCss)) issues.add('customCss', 'must not contain </style>');
  }
  checkString(issues, 'headCode', data.headCode, MAX_CODE_SNIPPET, false);
  checkString(issues, 'bodyEndCode', data.bodyEndCode, MAX_CODE_SNIPPET, false);

  if (!isRecord(data.layouts)) issues.add('layouts', 'must be an object');
  else {
    for (const [typeId, key] of Object.entries(data.layouts)) {
      if (!(typeof key === 'string' && DESIGN_KEY.test(key)))
        issues.add(join('layouts', typeId), 'must be a layout key');
    }
  }
}

const VALIDATORS: Record<SiteDesignKind, (issues: Issues, data: Record<string, unknown>) => void> =
  {
    theme: validateTheme,
    block: validateBlock,
    page: validatePage,
    layout: validateLayout,
    menu: validateMenu,
    site: validateSite,
  };

/** Checks a design document of any kind; issues carry dotted paths into it. */
export function validateSiteDesign<K extends SiteDesignKind>(
  kind: K,
  data: unknown,
): SiteValidationResult<SiteDesignData<K>> {
  const issues = new Issues();
  if (!(SITE_DESIGN_KINDS as readonly string[]).includes(kind)) {
    issues.add('', `unknown design kind ${String(kind)}`);
  } else if (!isRecord(data)) {
    issues.add('', 'must be an object');
  } else if (!checkTooLarge(issues, data, MAX_DESIGN_BYTES)) {
    VALIDATORS[kind](issues, data);
  }
  return issues.list.length === 0
    ? { ok: true, value: data as SiteDesignData<K> }
    : { ok: false, issues: issues.list };
}

/** Checks a block instance's style overrides (`style` of `BlockInstanceDesign`). */
export function validateInstanceStyle(value: unknown): SiteValidationResult<InstanceStyle> {
  const issues = new Issues();
  if (!isRecord(value)) {
    issues.add('', 'must be an object');
    return { ok: false, issues: issues.list };
  }
  onlyKeys(issues, '', value, [
    'background',
    'backgroundImage',
    'paddingY',
    'paddingX',
    'gap',
    'textAlign',
    'width',
    'hide',
  ]);
  const { background, backgroundImage, paddingY, paddingX, gap, hide, width, textAlign } = value;
  checkStyleProps(issues, '', { background, backgroundImage, paddingY, paddingX, gap });
  checkEnum(issues, 'textAlign', textAlign, ['left', 'center', 'right'], false);
  checkEnum(issues, 'width', width, ['contained', 'full'], false);
  if (
    hide !== undefined &&
    (!Array.isArray(hide) ||
      hide.some((entry) => !BREAKPOINTS.includes(entry)) ||
      new Set(hide).size !== hide.length)
  )
    issues.add('hide', 'must list distinct breakpoints: desktop, tablet, mobile');
  return issues.list.length === 0
    ? { ok: true, value: value as InstanceStyle }
    : { ok: false, issues: issues.list };
}

/** Checks a block instance's design: a variant name and style overrides. */
export function validateInstanceDesign(value: unknown): SiteValidationResult<BlockInstanceDesign> {
  const issues = new Issues();
  if (!isRecord(value)) {
    issues.add('', 'must be an object');
    return { ok: false, issues: issues.list };
  }
  onlyKeys(issues, '', value, ['variant', 'style']);
  if (
    value.variant !== undefined &&
    (typeof value.variant !== 'string' || !DESIGN_KEY.test(value.variant))
  ) {
    issues.add('variant', 'must be a design key: a letter or digit, then letters, digits, _ or -');
  }
  if (value.style !== undefined) {
    const style = validateInstanceStyle(value.style);
    if (!style.ok)
      for (const issue of style.issues) issues.add(join('style', issue.path), issue.message);
  }
  return issues.list.length === 0
    ? { ok: true, value: value as BlockInstanceDesign }
    : { ok: false, issues: issues.list };
}
