#!/usr/bin/env node
// Flags a components/ui control bound with `:model-value` (or a named model) but neither
// `@update:...` nor `v-model`: its `defineModel` then keeps a local copy after a change.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve, sep } from 'node:path';
import { report, walk } from './lib/scan.mjs';

const args = process.argv.slice(2);
const roots = (args.length > 0 ? args : ['apps/admin/src', 'packages/admin-sdk/src']).map((dir) =>
  resolve(dir),
);
const { parse } = createRequire(resolve('apps/admin/package.json'))('vue/compiler-sfc');
const UIS = roots.map((root) => join(root, 'components', 'ui')).filter((ui) => existsSync(ui));

/* `file -> Component:model` uses that are meant to be one-way, each with its reason. */
const KNOWN_ONE_WAY = new Map([]);

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (name) => name.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

/** Each ui control's model names, by component name. */
const models = new Map();
for (const absolute of UIS.flatMap((ui) => [...walk(ui, { ext: /\.vue$/ })])) {
  const text = readFileSync(absolute, 'utf8');
  const names = [...text.matchAll(/defineModel(?:<[^(]*>)?\(\s*(?:'([^']+)')?/g)].map(
    (match) => match[1] ?? 'modelValue',
  );
  if (names.length > 0) models.set(basename(absolute, '.vue'), new Set(names));
}

const IMPORT = /import\s+(\w+)\s+from\s+'(?:[^']*\/components\/ui\/|\.\/|\.\.\/ui\/)(\w+)\.vue'/g;
const ELEMENT = 1;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

/** The static argument of a directive, camel-cased, or null for none or a dynamic one. */
const argOf = (prop) =>
  prop.arg ? (prop.arg.isStatic ? camel(prop.arg.content) : null) : undefined;

function* elements(node) {
  if (node.type === ELEMENT) yield node;
  for (const child of node.children ?? []) yield* elements(child);
  for (const branch of node.branches ?? []) yield* elements(branch);
}

const findings = [];
const seenExceptions = new Set();
for (const { root, absolute } of roots.flatMap((root) =>
  [...walk(root, { ext: /\.vue$/ })].map((absolute) => ({ root, absolute })),
)) {
  const text = readFileSync(absolute, 'utf8');
  const script = text.split('<template')[0];
  const local = new Map();
  for (const match of script.matchAll(IMPORT)) {
    if (models.has(match[2])) local.set(match[1], match[2]);
  }
  if (UIS.some((ui) => absolute.startsWith(ui + sep))) {
    for (const name of models.keys()) local.set(name, name);
  }
  if (local.size === 0) continue;
  const tags = new Map();
  for (const [name, component] of local) {
    tags.set(name, component);
    tags.set(kebab(name).replace(/^-/, ''), component);
  }

  const { descriptor } = parse(text, { filename: absolute });
  if (!descriptor.template?.ast) continue;
  const file = relative(root, absolute).split(sep).join('/');
  for (const node of elements(descriptor.template.ast)) {
    const component = tags.get(node.tag);
    if (!component) continue;
    for (const model of models.get(component)) {
      let bound = false;
      let handled = false;
      for (const prop of node.props) {
        if (prop.type === ATTRIBUTE && camel(prop.name) === model) bound = true;
        // A static `readonly` or `disabled` control never changes.
        if (prop.type === ATTRIBUTE && /^(readonly|disabled)$/.test(prop.name)) handled = true;
        if (prop.type !== DIRECTIVE) continue;
        const arg = argOf(prop);
        if (prop.name === 'bind' && arg === model) bound = true;
        if (prop.name === 'bind' && arg === undefined) handled = true;
        if (prop.name === 'model' && (arg ?? 'modelValue') === model) handled = true;
        if (prop.name === 'on' && (arg === `update:${model}` || !arg)) handled = true;
      }
      if (!bound || handled) continue;
      const key = `${file} -> ${component}:${model}`;
      if (KNOWN_ONE_WAY.has(key)) {
        seenExceptions.add(key);
        continue;
      }
      findings.push({
        where: `${relative(process.cwd(), absolute)}:${node.loc.start.line}`,
        found: `<${node.tag} :${kebab(model)}>`,
        message: `bound without @update:${kebab(model)} or v-model; the control keeps a local copy`,
      });
    }
  }
}

// An exception nobody uses any more is removed, so the list only shrinks.
for (const known of KNOWN_ONE_WAY.keys()) {
  if (!seenExceptions.has(known)) {
    findings.push({
      where: 'scripts/check-admin-models.mjs',
      found: known,
      message: 'stale exception; remove it',
    });
  }
}

report(
  'admin models',
  findings,
  `${models.size} controls with a model, ${KNOWN_ONE_WAY.size} known exceptions`,
);
