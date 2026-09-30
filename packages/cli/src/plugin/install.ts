import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliContribution, CliValues } from '@manablox/core';
import { optionsBeyondCore, optionValues, type ParsedArgs } from '../args.js';
import { generateSecrets } from '../create/index.js';
import {
  LICENSE_PLUGIN,
  licenseSteps,
  type PremiumProduct,
  premiumProducts,
  premiumPrompt,
  uncovered,
} from '../license.js';
import { addCommand, installCommand, removeCommand } from '../package-manager.js';
import { type CliPlugin, firstParty, firstPartyPlugins, withRequired } from '../plugins.js';
import { planInstall } from './edit.js';
import {
  applyEdit,
  configuredIds,
  contributionOf,
  declaredPlugin,
  installedPlugins,
  instanceManifest,
  instanceOf,
  PLUGINS_FILE,
  type PluginContext,
  packageManagerOf,
  printManual,
} from './instance.js';
import { migrateAfterInstall, restartSteps } from './steps.js';

/** A plugin `install` was asked for, resolved. */
interface Target {
  id: string;
  package: string;
  /** The `package.json` range. */
  range: string;
  contribution: CliContribution | null;
  requires: readonly string[];
  /** Added with the package manager, which picks the range. */
  added: boolean;
}

/** `name`, `@scope/name`, `name@range` or `@scope/name@range`. */
function splitSpec(spec: string): { name: string; range: string | null } {
  const at = spec.lastIndexOf('@');
  return at > 0
    ? { name: spec.slice(0, at), range: spec.slice(at + 1) }
    : { name: spec, range: null };
}

/**
 * `manablox plugin install <id|package>...`: adds the dependency, the plugin's marked parts
 * and whole files, installs with the instance's package manager and migrates.
 */
export async function installCommandRun(args: ParsedArgs, context: PluginContext): Promise<number> {
  const wanted = args.positionals.slice(1);
  if (!wanted.length) {
    context.err.write('manablox: plugin install needs a plugin id or package, e.g. ai\n');
    return 1;
  }
  const install = args.flags['no-install'] !== true;
  const dir = context.cwd;
  const manager = packageManagerOf(context);
  const { options, instance } = instanceOf(context);
  const { pluginId } = await import('@manablox/core');

  // First-party plugins the named ones require come along, unless the instance has them.
  const present = new Set([
    ...(await installedPlugins(dir)).map((plugin) => plugin.id),
    ...configuredIds(dir),
  ]);
  const required = withRequired(wanted.filter((entry) => firstParty(entry))).filter(
    (id) => !wanted.includes(id) && !present.has(id),
  );
  for (const id of required) {
    const by = wanted.filter((entry) => entry !== id && withRequired([entry]).includes(id));
    context.out.write(
      `manablox: installing the ${id} plugin too; ${by.join(', ')} ${by.length > 1 ? 'require' : 'requires'} it\n`,
    );
  }
  // First-party ids come from the catalogue, at the range the instance's packages use.
  const known = [...required, ...wanted].map((entry) => ({ entry, plugin: firstParty(entry) }));
  const ids = known.flatMap(({ plugin }) => (plugin ? [plugin.id] : []));
  let contributions = await firstPartyPlugins(dir);
  // The named first-party plugins' `create` options, checked before anything changes; the
  // parser found them beside the CLI or in its cache. One none of them takes is refused.
  const values = new Map<string, CliValues>();
  const taken = new Set<string>();
  for (const loaded of contributions.filter((entry) => ids.includes(entry.id))) {
    const group = loaded.contribution.options?.create;
    if (!group) continue;
    const given = optionValues(args, group.options);
    await group.check?.(given);
    values.set(loaded.id, given);
    for (const option of group.options) taken.add(option.name);
  }
  const stray = optionsBeyondCore(args, 'plugin').find((name) => !taken.has(name));
  if (stray) {
    context.err.write(
      `manablox: --${stray} belongs to none of the plugins being installed (${wanted.join(', ')})\n`,
    );
    return 1;
  }
  // Packages already in the instance, with package.json updated, before the parts are written.
  const preinstalled = new Set<string>();
  const absent = known.flatMap(({ plugin }) =>
    plugin && !contributions.some((loaded) => loaded.id === plugin.id) ? [plugin] : [],
  );
  if (absent.length && install) {
    // Into the instance first, where its CLI part is then read from.
    const manifestPath = join(dir, 'package.json');
    const before = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(before) as { dependencies?: Record<string, string> };
    const deps: Record<string, string> = { ...manifest.dependencies };
    for (const plugin of absent) deps[plugin.package] = options.manabloxVersion;
    manifest.dependencies = Object.fromEntries(
      Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const [command, commandArgs, env] = installCommand(manager);
    context.out.write(`manablox: running ${command} ${commandArgs.join(' ')}\n`);
    const result = await context.run(command, commandArgs, dir, env);
    if (result.code !== 0) {
      writeFileSync(manifestPath, before);
      context.err.write(
        `manablox: ${command} ${commandArgs.join(' ')} exited with ${result.code}; nothing was installed\n${result.output.trim()}\n`,
      );
      return 1;
    }
    for (const plugin of absent) preinstalled.add(plugin.id);
    contributions = await firstPartyPlugins(dir);
  } else if (absent.length) {
    // Without installing, the CLI reads them from its cache.
    contributions = await firstPartyPlugins(dir, {
      install: ids,
      onInstall: (specs) => context.err.write(`manablox: fetching ${specs.join(' ')}\n`),
    });
  }
  const targets: Target[] = [];
  for (const { entry, plugin } of known) {
    if (plugin) {
      targets.push({
        id: plugin.id,
        package: plugin.package,
        range: options.manabloxVersion,
        contribution: contributions.find((loaded) => loaded.id === plugin.id)?.contribution ?? null,
        requires: plugin.requires,
        added: false,
      });
      continue;
    }
    // Any other package must be in node_modules to say what it is.
    const { name, range } = splitSpec(entry);
    const manifest = instanceManifest(dir);
    let present = declaredPlugin(dir, name, range ?? '', pluginId);
    let added = false;
    const listed = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    if (!present || !listed) {
      if (!install) {
        context.err.write(
          `manablox: ${name} is not installed; without --no-install it is added and read first\n`,
        );
        return 1;
      }
      const [command, commandArgs] = addCommand(manager, [range ? `${name}@${range}` : name]);
      const result = await context.run(command, commandArgs, dir);
      if (result.code !== 0) {
        context.err.write(
          `manablox: ${command} ${commandArgs.join(' ')} failed\n${result.output.trim()}\n`,
        );
        return 1;
      }
      added = true;
      present = declaredPlugin(dir, name, range ?? '', pluginId);
      if (!present) {
        // Not a plugin after all: take it out again.
        const [undo, undoArgs] = removeCommand(manager, [name]);
        await context.run(undo, undoArgs, dir);
        context.err.write(
          `manablox: ${name} is not a manablox plugin (its package.json has no "manablox" field with "plugin"); removed it again\n`,
        );
        return 1;
      }
    }
    targets.push({
      id: present.id,
      package: name,
      range: instanceManifest(dir).dependencies?.[name] ?? present.range,
      contribution: await contributionOf(dir, present.cli),
      requires: present.requires,
      added,
    });
  }

  // Everything required is there already or comes with this call.
  const installed = await installedPlugins(dir);
  const have = new Set([
    ...installed.map((plugin) => plugin.id),
    ...configuredIds(dir),
    ...targets.map((target) => target.id),
  ]);
  for (const target of targets) {
    const missing = target.requires.filter((id) => !have.has(id));
    if (missing.length) {
      context.err.write(
        `manablox: the ${target.id} plugin requires ${missing.join(', ')}; install ${missing.length > 1 ? 'them' : 'it'} too: manablox plugin install ${[...missing, target.id].join(' ')}\n`,
      );
      return 1;
    }
  }

  const configured = new Set(configuredIds(dir));
  const nextSteps: string[] = [];
  const added: string[] = [];
  let manual = 0;
  let changed = 0;
  let manifestChanged = false;
  for (const target of targets) {
    const listed = installed.some((plugin) => plugin.package === target.package);
    if (listed && configured.has(target.id)) {
      context.out.write(`manablox: the ${target.id} plugin is installed already\n`);
      continue;
    }
    const answers =
      (await target.contribution?.install?.({
        instance,
        prompter: context.prompter,
        values: values.get(target.id) ?? {},
      })) ?? {};
    const templates = (await target.contribution?.templates?.({
      instance,
      values: answers.values,
    })) ?? { dependencies: { [target.package]: target.range } };
    const edit = planInstall(dir, options, generateSecrets(), {
      id: target.id,
      templates: {
        ...templates,
        dependencies: { ...templates.dependencies, [target.package]: target.range },
      },
    });
    const touched = applyEdit(dir, edit);
    manifestChanged ||= touched.includes('package.json');
    if ((preinstalled.has(target.id) || target.added) && !touched.includes('package.json')) {
      touched.push('package.json');
    }
    changed += touched.length;
    manual += edit.manual.length;
    printManual(context, target.id, edit);
    context.out.write(
      `manablox: installed the ${target.id} plugin (${target.package}@${target.range})${touched.length ? `: ${touched.join(', ')}` : ''}\n`,
    );
    if (!target.contribution?.templates) {
      context.out.write(
        `  ${target.package} adds no parts to the instance files; add it to ${PLUGINS_FILE} as its README says\n`,
      );
    }
    nextSteps.push(...(answers.nextSteps ?? []));
    added.push(target.id);
  }

  // Installed already when the packages came in first; again only for what the parts changed.
  let installedNow =
    install && targets.some((target) => preinstalled.has(target.id) || target.added);
  if (install && manifestChanged) {
    const [command, commandArgs, env] = installCommand(manager);
    context.out.write(`manablox: running ${command} ${commandArgs.join(' ')}\n`);
    const result = await context.run(command, commandArgs, dir, env);
    installedNow = result.code === 0;
    if (!installedNow) {
      context.err.write(
        `manablox: ${command} ${commandArgs.join(' ')} exited with ${result.code}; run it yourself\n${result.output.trim()}\n`,
      );
    }
  }

  if (changed) {
    const migrated = await migrateAfterInstall(args, context, options, {
      install,
      installed: installedNow,
      manager,
    });
    await licensePremium(premiumProducts(added), context, {
      config: args.options.config,
      migrated,
      license: contributions.find((loaded) => loaded.id === LICENSE_PLUGIN),
    });
    const steps = [...restartSteps(options, manager, !install), ...nextSteps];
    context.out.write(`\nNext steps\n${steps.map((line) => `  ${line}`).join('\n')}\n`);
  }
  return manual && args.flags.strict ? 1 : 0;
}

/** The premium plugins just installed: the license prompt for those no license covers. */
async function licensePremium(
  products: readonly PremiumProduct[],
  context: PluginContext,
  state: { config: string | undefined; migrated: boolean; license: CliPlugin | undefined },
): Promise<void> {
  if (!products.length) return;
  if (!state.license) {
    context.out.write(
      `\nPremium plugins need a license:\n${licenseSteps(products)
        .map((line) => `  ${line}\n`)
        .join('')}`,
    );
    return;
  }
  const setup = {
    cwd: context.cwd,
    config: state.config,
    out: context.out,
    err: context.err,
    prompter: context.prompter,
    tty: context.tty,
    license: state.license,
    ready: state.migrated,
  };
  const missing = await uncovered(products, setup);
  if (!missing.products.length) return;
  context.out.write('\n');
  await premiumPrompt(missing.products, { ...setup, development: missing.development });
}
