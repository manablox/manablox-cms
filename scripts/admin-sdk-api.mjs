#!/usr/bin/env node
// Writes one API report per public entry of the admin SDK: packages/admin-sdk/admin-sdk.api.md
// for `@manablox/admin-sdk` and admin-sdk-testing.api.md for `@manablox/admin-sdk/testing`.
// Each lists the entry's exports with the declarations they reach inside the package, from
// the emitted .d.ts files. `--check` fails when a committed report differs, so a surface
// change shows up in review.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages', 'admin-sdk');
/** The entries plugins import, by the emitted declaration file each one's types are. */
const entries = [
  { name: '@manablox/admin-sdk', dts: 'index.d.ts', report: 'admin-sdk.api.md' },
  { name: '@manablox/admin-sdk/testing', dts: 'testing.d.ts', report: 'admin-sdk-testing.api.md' },
];
// Inside the package, so the declarations resolve `vue` and the other dependencies.
const out = join(pkg, 'node_modules', '.cache', 'api-report');

const require = createRequire(join(pkg, 'package.json'));
const ts = require('typescript');

rmSync(out, { recursive: true, force: true });
try {
  execFileSync(
    join(pkg, 'node_modules', '.bin', 'vue-tsc'),
    ['-p', 'tsconfig.build.json', '--outDir', out],
    { cwd: pkg, stdio: 'pipe' },
  );
} catch (error) {
  // Type errors still emit; the typecheck task reports them.
  if (!error.stdout?.length && !error.stderr?.length) throw error;
}

const program = ts.createProgram(
  entries.map((entry) => join(out, entry.dts)),
  {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
);
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true });
const local = (file) => file.fileName.startsWith(`${out}/`);

/** The top-level statement a declaration belongs to, if it is one of the package's. */
function statementOf(declaration) {
  const file = declaration.getSourceFile();
  if (!local(file)) return null;
  let node = declaration;
  while (node.parent && node.parent !== file) node = node.parent;
  return node.parent === file && !ts.isImportDeclaration(node) && !ts.isExportAssignment(node)
    ? node
    : null;
}

function resolved(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

const memberName = (member, file) => member.name?.getText(file) ?? '';

/** Sorts the members of object types passed as type arguments; vue-tsc infers them in any order. */
const sortInferred = (file) => (context) => {
  const visit = (node) => {
    const next = ts.visitEachChild(node, visit, context);
    if (!ts.isTypeLiteralNode(next) || !node.parent?.typeArguments?.includes(node)) return next;
    const members = [...next.members].sort((a, b) =>
      memberName(a, file).localeCompare(memberName(b, file)),
    );
    return context.factory.updateTypeLiteralNode(next, context.factory.createNodeArray(members));
  };
  return (node) => ts.visitNode(node, visit);
};

/** The report of one entry: its exports, then every declaration they reach, by file. */
function reportOf(entry) {
  const index = join(out, entry.dts);
  const seen = new Set();
  const queue = [];
  const add = (symbol) => {
    for (const declaration of resolved(symbol).declarations ?? []) {
      const statement = statementOf(declaration);
      if (statement && !seen.has(statement)) {
        seen.add(statement);
        queue.push(statement);
      }
    }
  };

  const source = program.getSourceFile(index);
  if (!source) throw new Error(`vue-tsc emitted no ${relative(root, index)}`);
  const exports = checker
    .getExportsOfModule(checker.getSymbolAtLocation(source))
    .map((symbol) => {
      const target = resolved(symbol);
      const file = target.declarations?.[0]?.getSourceFile();
      add(symbol);
      const where = file && local(file) ? relative(out, file.fileName) : 'external';
      return `${symbol.name}: ${where}#${target.name}`;
    })
    .sort();

  while (queue.length > 0) {
    const statement = queue.shift();
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) add(symbol);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(statement, visit);
  }

  const byFile = new Map();
  for (const statement of seen) {
    const file = statement.getSourceFile();
    const list = byFile.get(file) ?? [];
    list.push(statement);
    byFile.set(file, list);
  }

  const sections = [...byFile]
    .map(([file, statements]) => ({
      name: relative(out, file.fileName),
      text: statements
        .sort((a, b) => a.pos - b.pos)
        .map((statement) => {
          const [node] = ts.transform(statement, [sortInferred(file)]).transformed;
          return printer.printNode(ts.EmitHint.Unspecified, node, file);
        })
        .join('\n'),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return [
    `# ${entry.name} API report`,
    '',
    'Generated by `pnpm sdk:api`; `pnpm sdk:api:check` fails when the surface changes.',
    'A breaking change raises `SDK_API_LEVEL`.',
    '',
    '## Exports',
    '',
    '```text',
    ...exports,
    '```',
    ...sections.flatMap(({ name, text }) => ['', `## ${name}`, '', '```ts', text, '```']),
    '',
  ].join('\n');
}

const reports = entries.map((entry) => ({ path: join(pkg, entry.report), text: reportOf(entry) }));

rmSync(out, { recursive: true, force: true });

if (!process.argv.includes('--check')) {
  for (const { path, text } of reports) {
    writeFileSync(path, text);
    console.log(`wrote ${relative(root, path)}`);
  }
  process.exit(0);
}

let changed = false;
for (const { path, text } of reports) {
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {}
  if (current === text) continue;
  changed = true;
  const was = current.split('\n');
  const now = text.split('\n');
  const line = now.findIndex((row, index) => row !== was[index]);
  console.error(`The admin SDK surface changed (${relative(root, path)}, line ${line + 1}):`);
  console.error(`  committed: ${was[line] ?? '(end of file)'}`);
  console.error(`  now:       ${now[line] ?? '(end of file)'}`);
}
if (!changed) {
  console.log('admin SDK surface unchanged');
  process.exit(0);
}
console.error(
  '\nRun `pnpm sdk:api` and commit the reports; raise SDK_API_LEVEL if the change breaks plugins.',
);
process.exit(1);
