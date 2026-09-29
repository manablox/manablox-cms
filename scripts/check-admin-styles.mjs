#!/usr/bin/env node
// Flags admin, admin-sdk and plugin admin code that bypasses design tokens, and plugin admin
// code using utilities without the plugin's prefix. `src/styles/` is exempt.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { lineOf, report, walk } from './lib/scan.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const roots = (
  args.length > 0
    ? args
    : [
        'apps/admin/src',
        'packages/admin-sdk/src',
        'packages/plugin-license/src/admin',
        'packages/plugin-webhooks/src/admin',
        'packages/plugin-workflows/src/admin',
      ]
).map((dir) => resolve(dir));

/** A pattern and its replacement; `skip` exempts specific matches. */
const RULES = [
  {
    id: 'arbitrary-type',
    pattern: /\btext-\[[^\]]+\]/g,
    message: 'arbitrary font size; use text-2xs / text-xs / text-sm / ... from the type scale',
  },
  {
    id: 'stock-radius',
    pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/g,
    message: 'stock radius; use rounded-control / rounded-popover / rounded-card / rounded-pill',
    skip: (m) => m === 'rounded-sm',
  },
  {
    id: 'stock-hue',
    pattern:
      /\b(?:bg|text|border|fill|stroke|ring|from|to|via|shadow|outline|divide|accent|caret)-(?:violet|indigo|purple|cyan|sky|teal|pink|fuchsia|rose|red|orange|amber|yellow|green|emerald|lime|blue|gray|zinc|slate|neutral|stone)-\d{2,3}\b/g,
    message:
      'stock Tailwind hue; the admin has surface / brand / iris / ochre / ok / warn / danger',
  },
  {
    id: 'control-override',
    pattern:
      /\bmb-(?:input|btn-[a-z-]+|control)\b[^"']*?\s(?:p[xytrbl]?-[\d.]+|text-(?:xs|sm|base|lg)|h-[\d.]+)\b/g,
    message: 'a control overriding its own size; use the -sm / -lg / -icon / -mono modifiers',
  },
  {
    id: 'raw-z-index',
    pattern: /\bz-(?:\[\d+\]|\d+)\b/g,
    message: 'raw z-index; use mb-z-sticky / -panel / -drawer / -overlay / -popover / -toast',
  },
  {
    id: 'stock-shadow',
    pattern: /\bshadow-(?:md|lg|xl|2xl)\b/g,
    message: 'stock shadow; anchored surfaces use shadow-pop, centred ones shadow-modal',
  },
  {
    id: 'raw-duration',
    pattern: /\b(?:duration|delay)-\d+\b/g,
    message: 'raw duration; use --mb-dur-fast / --mb-dur / --mb-dur-slow',
  },
  {
    id: 'hover-reveal',
    pattern:
      /\bgroup-(?:hover|focus-within):(?:block|flex|inline|inline-flex|visible|opacity-100)\b/g,
    message: 'a hover-only reveal, out of reach on touch; use mb-row-action',
  },
  {
    id: 'divided-list',
    pattern: /\bdivide-y\b/g,
    message: 'a divided list built from utilities; use mb-list-divided',
  },
  {
    id: 'toast-caught',
    pattern: /\btoast\.caught\(/g,
    message: 'a hand-caught write failure; use runWrite / confirmAndRun from lib/write',
    applies: (file) => !roots.some((root) => file.startsWith(join(root, 'lib'))),
  },
  {
    id: 'meta-text',
    pattern:
      /\b(?:[a-z]+:)?text-xs (?:[a-z]+:)?text-surface-500\b|\b(?:[a-z]+:)?text-surface-500 (?:[a-z]+:)?text-xs\b/g,
    message: 'secondary text built from utilities; use mb-meta',
  },
  {
    id: 'link-class',
    pattern: /\b(?:[a-z]+:)?font-medium (?:[a-z]+:)?text-brand-700 (?:[a-z]+:)?hover:underline\b/g,
    message: 'a link styled from utilities; use mb-link',
  },
  {
    id: 'spinner-swap',
    pattern: /'spinner'\s*:/g,
    message:
      'an icon swapped for a spinner by hand; use SaveButton with icon or IconButton with busy',
    applies: (file) => !isPrimitive(file),
    // A popover trigger is a plain element the popover binds itself to.
    skipLine: (lines, index) => inTrigger(lines.slice(Math.max(0, index - 3), index).join('\n')),
  },
  {
    id: 'event-target-cast',
    pattern: /\$event\.target as HTML(?:Input|TextArea|Select)Element/g,
    message:
      'a value read off the event by hand; bind it with v-model or use TextField / NumberField',
    applies: (file) => !isPrimitive(file),
  },
  {
    id: 'hand-built-copy',
    pattern: /@click="copyText\(/g,
    message: 'a hand-built copy button; use components/ui/CopyField.vue',
    applies: (file) => !isPrimitive(file),
  },
  {
    id: 'inline-write-feedback',
    pattern: /\berror\.value = messageFor\(|\btoast\.error\(messageFor\(/g,
    message: 'a hand-rolled write failure; use runWrite / confirmAndRun from lib/write',
  },
];

/*
 * Form controls belong to the primitives in `components/ui/` (FormField, TextField,
 * TextareaField, NumberField, SearchField, Checkbox, Radio, RadioCard, Switch, CheckCard,
 * ChipToggle, Select). These rules run on whole tags, so a multi-line tag is one match.
 * A raw `<input>` or `<textarea>` is fine when it is the control a FormField hands its id to
 * (`:id="id"`), is named by `aria-label`, or is a search box, since none has a label pair.
 */
const TAG_RULES = [
  {
    id: 'raw-label',
    pattern: /<label\b[^>]*\bclass="mb-label\b[^>]*>/g,
    message: 'a hand-written label; use FormField / TextField / TextareaField',
  },
  {
    id: 'raw-input',
    pattern: /<(?:input|textarea)\b[^>]*\bclass="mb-input\b[^>]*>/g,
    message: 'a bare mb-input; use TextField / TextareaField, or a FormField slot with :id="id"',
    skip: (tag) =>
      /\s:id="id"|\saria-label=|\s:aria-label=|\saria-labelledby=|\stype="search"/.test(tag),
  },
  {
    id: 'raw-checkbox',
    pattern: /<input\b[^>]*\btype="checkbox"[^>]*>/g,
    message: 'a raw checkbox; use Checkbox / CheckCard / ChipToggle / Switch',
  },
  {
    id: 'raw-radio',
    pattern: /<input\b[^>]*\btype="radio"[^>]*>/g,
    message: 'a raw radio; use Radio / RadioCard / SegmentedControl',
  },
  {
    id: 'raw-select',
    pattern: /<select\b[^>]*>/g,
    message: 'a native select; use components/ui/Select.vue',
  },
  {
    // A loader whose sibling is an "empty" branch: the shape AsyncList renders.
    id: 'loader-list',
    pattern:
      /<(?:Page)?Loader\b[^>]*\bv-if=[^>]*\/>\s*<[A-Za-z]+\b[^>]*\bv-else-if="![^"]*length"/g,
    message: 'a hand-rolled loading and empty branch; use AsyncList',
  },
  {
    // Previous/next buttons stepping a page or offset ref.
    id: 'hand-rolled-pager',
    pattern:
      /<button\b[^>]*(?:aria-label="(?:Previous|Next) page"|@click="[\w.]*(?:page|offset)\s*(?:\+\+|--|[+-]=|=\s*Math\.(?:max|min)\()[^"]*")[^>]*>/gi,
    message: 'a hand-rolled pager; use components/ui/Pager.vue with usePagedQuery',
  },
  {
    id: 'raw-number-input',
    pattern: /<input\b[^>]*\btype="number"[^>]*>/g,
    message: 'a raw number input; use components/ui/NumberField.vue',
  },
  {
    id: 'hand-built-search',
    pattern: /<input\b[^>]*\bmb-input-leading\b[^>]*>/g,
    // Only a leading search icon makes it a search box.
    near: /<Icon\b[^>]*\bname="search"/,
    message: 'a hand-built search box; use components/ui/SearchField.vue',
  },
  {
    id: 'hand-built-sort-header',
    pattern: /<[a-z]+\b[^>]*\s:aria-sort=[^>]*>/g,
    message: 'a hand-built sort header; use components/ui/SortHeader.vue with useSort',
  },
  {
    // A trash button coloured by hand instead of the ghost-danger button.
    id: 'raw-danger-icon',
    pattern:
      /<button\b[^>]*\bclass="(?![^"]*\bmb-btn-)[^"]*\btext-danger-\d+[^"]*"[^>]*>\s*<Icon\b[^>]*\bname="trash"/g,
    message: 'a hand-coloured delete icon; use mb-btn-ghost-danger mb-btn-icon with an aria-label',
  },
  {
    // A button holding nothing but an icon.
    id: 'hand-built-icon-button',
    pattern: /<button\b[^>]*\bmb-btn-icon\b[^>]*>\s*<Icon\b[^>]*\/>\s*<\/button>/g,
    message: 'a hand-built icon button; use components/ui/IconButton.vue',
    skipBefore: inTrigger,
  },
  {
    // The page's create button with its `n` shortcut.
    id: 'hand-built-new-button',
    pattern:
      /<(?:button|RouterLink)\b(?=[^>]*shortcutHint\('n')(?=[^>]*(?:@click|\sto|:to)=)[^>]*>/g,
    message: "a create button with the 'n' shortcut built by hand; use components/ui/NewButton.vue",
  },
  {
    id: 'raw-json-pre',
    pattern: /<pre\b[^>]*>\s*\{\{\s*JSON\.stringify\(/g,
    message: 'a hand-built JSON viewer; use components/ui/JsonBlock.vue',
  },
];

/** Rules that need the whole file; each yields `{ index, found }`. */
const FILE_RULES = [
  {
    // A `<form>` inside `<Dialog>`: FormDialog adds the form, Enter, Cancel and busy state.
    id: 'dialog-form',
    applies: (file) => file.endsWith('.vue') && !isPrimitive(file),
    *find(text) {
      for (const open of text.matchAll(/<Dialog[\s>]/g)) {
        const close = text.indexOf('</Dialog>', open.index);
        const body = text.slice(open.index, close === -1 ? undefined : close);
        const form = body.search(/<form\b/);
        if (form !== -1) yield { index: open.index + form, found: '<form> in <Dialog>' };
      }
    },
    message: 'a form built inside a Dialog; use components/ui/FormDialog.vue',
  },
  {
    // Constants a component exports are loaded with it; shared values live in lib/.
    id: 'vue-runtime-export',
    applies: (file) => file.endsWith('.vue'),
    *find(text) {
      const pattern =
        /^\s*export\s+(?:(?:default\s+)?(?:const|let|var|function|async\s+function|class|enum)\b|\{|\*).*$/gm;
      for (const match of text.matchAll(pattern))
        yield { index: match.index, found: match[0].trim() };
    },
    message: 'a .vue file exporting a runtime value; move it to lib/ or the feature model',
  },
];

/** Whether text ends inside a `#trigger` slot, whose element a popover binds itself to. */
function inTrigger(before) {
  const open = before.lastIndexOf('#trigger>');
  return open !== -1 && !before.slice(open).includes('</template>');
}

function isPrimitive(file) {
  return roots.some((root) => file.startsWith(join(root, 'components', 'ui')));
}

const files = roots.flatMap((root) => [
  ...walk(root, { skip: (path) => path.startsWith(join(root, 'styles')) }),
]);
const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!isPrimitive(file) && file.endsWith('.vue')) {
    for (const rule of TAG_RULES) {
      for (const match of text.matchAll(rule.pattern)) {
        if (rule.skip?.(match[0])) continue;
        if (rule.skipBefore?.(text.slice(Math.max(0, match.index - 200), match.index))) continue;
        if (rule.near && !rule.near.test(text.slice(Math.max(0, match.index - 400), match.index))) {
          continue;
        }
        findings.push({
          rule: rule.id,
          where: `${relative(process.cwd(), file)}:${lineOf(text, match.index)}`,
          found: match[0].split('\n')[0],
          message: rule.message,
        });
      }
    }
  }
  for (const rule of FILE_RULES) {
    if (!rule.applies(file)) continue;
    for (const { index, found } of rule.find(text)) {
      findings.push({
        rule: rule.id,
        where: `${relative(process.cwd(), file)}:${lineOf(text, index)}`,
        found,
        message: rule.message,
      });
    }
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    // Skip comment lines.
    if (/^\s*(\/\/|\*|<!--)/.test(line)) return;
    for (const rule of RULES) {
      if (rule.applies && !rule.applies(file)) continue;
      if (rule.skipLine?.(lines, index)) continue;
      for (const match of line.match(rule.pattern) ?? []) {
        if (rule.skip?.(match)) continue;
        findings.push({
          rule: rule.id,
          where: `${relative(process.cwd(), file)}:${index + 1}`,
          found: match,
          message: rule.message,
        });
      }
    }
  });
}

/*
 * A plugin admin root has a `style.css` importing the preset. Its class strings may only use
 * utilities with its prefix: template class attributes and bindings (strings in template
 * literal placeholders included), and script strings that hold a prefixed utility or two or
 * more class names. Tailwind itself decides what is a utility; one whose value the admin's
 * theme lacks (`ok-300`) is flagged too, since it styles nothing.
 */
const PRESET = /@import\s+["']@manablox\/admin-plugin\/tailwind\.css["']([^;]*);/;
const CLASS_ATTR = /\s(:|v-bind:)?(class|[\w-]+-class|[a-zA-Z]+Class)="([^"]*)"/g;
const LITERAL = /(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;

function tailwindNode(root) {
  const fromRoot = createRequire(join(root, 'index.ts'));
  const fromVite = createRequire(fromRoot.resolve('@tailwindcss/vite'));
  return fromVite('@tailwindcss/node');
}

const defined = (css) => new Set([...css.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)].map((m) => m[1]));
let adminVariables;

/*
 * The plugin's sheet, built from the prefixed classes in its sources, may only reference the
 * admin sheet's variables: each `--xy-*` token is `var(--*)` of an admin variable.
 */
async function tokenFindings(root, prefix, compile) {
  const build = async (file, candidates) =>
    (await compile(readFileSync(file, 'utf8'), { base: dirname(file), onDependency() {} })).build(
      candidates,
    );
  adminVariables ??= defined(await build(resolve('apps/admin/src/style.css'), []));
  const candidates = new Set();
  const token = new RegExp(`${prefix}:[^\\s"'\`]+`, 'g');
  for (const file of walk(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(token)) candidates.add(match[0]);
  }
  const css = await build(join(root, 'style.css'), [...candidates]);
  const own = defined(css);
  const where = relative(process.cwd(), join(root, 'style.css'));
  const out = [];
  const flag = (found, message) => out.push({ rule: 'plugin-tokens', where, found, message });
  for (const [, name, value] of css.matchAll(
    new RegExp(`(--${prefix}-[\\w-]+):\\s*([^;}]+)`, 'g'),
  )) {
    if (/-(container|breakpoint)-/.test(name)) continue;
    const target = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
    if (target !== name.replace(`--${prefix}-`, '--')) {
      flag(`${name}: ${value}`, 'a plugin token that is not the admin variable of its name');
    } else if (!adminVariables.has(target)) {
      flag(name, `${target} is not in the admin sheet; its theme must be static`);
    }
  }
  for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) {
    if (!name.startsWith('--tw-') && !own.has(name) && !adminVariables.has(name)) {
      flag(name, 'a variable neither the plugin nor the admin sheet defines');
    }
  }
  return out;
}

async function prefixFindings(root) {
  const sheet = join(root, 'style.css');
  if (!existsSync(sheet)) return [];
  const css = readFileSync(sheet, 'utf8');
  const preset = PRESET.exec(css);
  if (!preset) return [];
  const where = relative(process.cwd(), sheet);
  const prefix = /\bprefix\(\s*([^)\s]*)\s*\)/.exec(preset[1] ?? '')?.[1];
  if (!prefix) {
    return [
      {
        rule: 'plugin-prefix',
        where,
        found: preset[0],
        message: 'import the preset with prefix(xy)',
      },
    ];
  }
  const tailwind = tailwindNode(root);
  const system = await tailwind.__unstable__loadDesignSystem(
    `@import "@manablox/admin-plugin/tailwind.css" prefix(${prefix});`,
    {
      base: root,
    },
  );
  const cache = new Map();
  const compiles = (candidate) => {
    if (!cache.has(candidate)) cache.set(candidate, system.candidatesToCss([candidate])[0] != null);
    return cache.get(candidate);
  };
  // Tailwind reads it as a utility (known root and variants), whether or not the theme has
  // its value: `border-ok-300` is one, though the admin has no `ok-300`.
  const shaped = (candidate) =>
    system
      .parseCandidate(candidate)
      .some((c) => c.kind === 'arbitrary' || (c.kind === 'functional' && c.value !== null));
  const prefixed = (token) => token.startsWith(`${prefix}:`);
  const component = (token) => /^mb-[a-z][a-z0-9-]*$/.test(token);
  const bare = (token) =>
    !prefixed(token) &&
    (compiles(`${prefix}:${token}`) || (!component(token) && shaped(`${prefix}:${token}`)));
  const unknown = (token) => prefixed(token) && shaped(token) && !compiles(token);
  const out = [];
  const check = (file, text, index, value, strict) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    // A script string is a class string when it has a prefixed utility or consists of classes.
    if (
      !strict &&
      !tokens.some((t) => prefixed(t) && shaped(t)) &&
      (tokens.length < 2 || !tokens.every((t) => prefixed(t) || component(t) || bare(t)))
    ) {
      return;
    }
    const where = `${relative(process.cwd(), file)}:${lineOf(text, index)}`;
    const found = tokens.filter(bare);
    if (found.length > 0) {
      out.push({
        rule: 'plugin-prefix',
        where,
        found: found.join(' '),
        message: `a utility without the plugin's prefix; write ${prefix}:${found[0]}`,
      });
    }
    const missing = tokens.filter(unknown);
    if (missing.length > 0) {
      out.push({
        rule: 'plugin-prefix',
        where,
        found: missing.join(' '),
        message: "a utility whose value the admin's theme does not have; it styles nothing",
      });
    }
  };
  const literals = (file, text, from, code, strict) => {
    for (const match of code.matchAll(LITERAL)) {
      // A compared value, not a class.
      const before = code.slice(Math.max(0, match.index - 4), match.index);
      const after = code.slice(match.index + match[0].length, match.index + match[0].length + 4);
      if (/[=!]=\s*$/.test(before) || /^\s*[=!]=/.test(after)) continue;
      const at = from + match.index;
      for (const part of match[2].split(/\$\{[^}]*\}/)) check(file, text, at, part, strict);
      // Strings inside a template literal's placeholders are class strings of their own.
      if (match[1] === '`') {
        for (const inner of match[2].matchAll(/\$\{([^}]*)\}/g)) {
          literals(file, text, at + inner.index, inner[1], strict);
        }
      }
    }
  };
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    if (!file.endsWith('.vue')) {
      literals(file, text, 0, text, false);
      continue;
    }
    const open = text.indexOf('<template>');
    const close = text.lastIndexOf('</template>');
    const template = open === -1 ? '' : text.slice(open, close);
    for (const match of template.matchAll(CLASS_ATTR)) {
      const at = open + match.index;
      if (match[1]) literals(file, text, at, match[3], true);
      else check(file, text, at, match[3], true);
    }
    for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      literals(file, text, script.index + script[0].indexOf('>') + 1, script[1], false);
    }
    const variant = new RegExp(`\\b${prefix}:(?:[\\w-]+:)*(group|peer)(?:/[\\w-]+)?-[\\w-]+`, 'g');
    for (const match of template.matchAll(variant)) {
      if (!new RegExp(`(^|[\\s"'\`])${prefix}:${match[1]}(/[\\w-]+)?([\\s"'\`]|$)`).test(text)) {
        out.push({
          rule: 'plugin-prefix',
          where: `${relative(process.cwd(), file)}:${lineOf(text, open + match.index)}`,
          found: match[0],
          message: `a ${match[1]} variant without a ${prefix}:${match[1]} element`,
        });
        break;
      }
    }
  }
  out.push(...(await tokenFindings(root, prefix, tailwind.compile)));
  return out;
}

for (const root of roots) findings.push(...(await prefixFindings(root)));

report('admin styles', findings, `${RULES.length + TAG_RULES.length + FILE_RULES.length} rules`);
