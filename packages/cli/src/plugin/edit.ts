import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateOptions } from '../create/options.js';
import { type InstancePlugin, renderFiles, type Secrets } from '../create/templates.js';
import {
  insertRegion,
  type Region,
  regionsOf,
  removeRegions,
  UnbalancedRegion,
} from '../regions.js';
import type { ScaffoldFile } from '../scaffold.js';

/** A part the command could not place, printed for the user to add or remove by hand. */
interface ManualPart {
  path: string;
  /** The anchor it belongs after; `null` for a whole file or `package.json`. */
  slot: string | null;
  text: string;
  reason: string;
}

/** What an install or uninstall writes; nothing is written until `applyEdit`. */
export interface PluginEdit {
  /** New contents by path, of the files that change. */
  writes: Map<string, ScaffoldFile>;
  deletes: string[];
  manual: ManualPart[];
  /** Files that already had the plugin's part, or a whole file the instance has already. */
  unchanged: string[];
}

const emptyEdit = (): PluginEdit => ({ writes: new Map(), deletes: [], manual: [], unchanged: [] });

function read(dir: string, path: string): string | null {
  const file = join(dir, ...path.split('/'));
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

interface Manifest {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/** Keys of an object in a new order; JSON keeps insertion order. */
function reordered<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries(entries);
}

/** `package.json` with the plugin's dependencies and scripts, placed where `create` puts them. */
function addToManifest(
  current: Manifest,
  rendered: Manifest,
  core: Manifest,
  dependencies: Record<string, string>,
): Manifest {
  const deps = { ...current.dependencies, ...dependencies };
  const out: Manifest = {
    ...current,
    dependencies: reordered(Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  const added = Object.entries(rendered.scripts ?? {}).filter(
    ([name]) => !Object.hasOwn(core.scripts ?? {}, name),
  );
  if (added.length) {
    const scripts = Object.entries(current.scripts ?? {});
    const order = Object.keys(rendered.scripts ?? {});
    for (const [name, value] of added) {
      if (scripts.some(([existing]) => existing === name)) continue;
      // Before the first script that follows it in a new instance and is still there.
      const after = order.slice(order.indexOf(name) + 1);
      const at = scripts.findIndex(([existing]) => after.includes(existing));
      scripts.splice(at === -1 ? scripts.length : at, 0, [name, value]);
    }
    out.scripts = reordered(scripts);
  }
  return out;
}

function manifestText(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The instance's files as `create` renders them, with and without the plugin. */
function renderBoth(options: CreateOptions, secrets: Secrets, plugin: InstancePlugin) {
  return {
    withPlugin: renderFiles(options, secrets, [plugin]),
    core: renderFiles(options, secrets, []),
  };
}

const parse = (content: string) => JSON.parse(content) as Manifest;

/**
 * Adds a plugin's parts to an instance: its marked regions at their anchors, its whole files
 * where missing, its dependencies and scripts in `package.json`. A file that lacks an anchor
 * the plugin needs is not written at all; its parts are returned as manual parts.
 */
export function planInstall(
  dir: string,
  options: CreateOptions,
  secrets: Secrets,
  plugin: InstancePlugin,
): PluginEdit {
  const edit = emptyEdit();
  const { withPlugin, core } = renderBoth(options, secrets, plugin);
  const ownFiles = new Set((plugin.templates.files ?? []).map((file) => file.path));
  for (const file of withPlugin) {
    const current = read(dir, file.path);
    if (file.path === 'package.json') {
      const coreManifest = core.find((entry) => entry.path === 'package.json');
      if (current === null || !coreManifest) {
        edit.manual.push({
          path: file.path,
          slot: null,
          text: JSON.stringify(plugin.templates.dependencies ?? {}, null, 2),
          reason: 'no package.json; add these dependencies',
        });
        continue;
      }
      let manifest: Manifest;
      try {
        manifest = parse(current);
      } catch {
        edit.manual.push({
          path: file.path,
          slot: null,
          text: JSON.stringify(plugin.templates.dependencies ?? {}, null, 2),
          reason: 'package.json is not valid JSON; add these dependencies',
        });
        continue;
      }
      const next = manifestText(
        addToManifest(
          manifest,
          parse(file.content),
          parse(coreManifest.content),
          plugin.templates.dependencies ?? {},
        ),
      );
      if (next === current) edit.unchanged.push(file.path);
      else edit.writes.set(file.path, { path: file.path, content: next });
      continue;
    }
    if (ownFiles.has(file.path)) {
      if (current === null) edit.writes.set(file.path, file);
      else edit.unchanged.push(file.path);
      continue;
    }
    const regions = regionsOf(file.content).filter((region) => region.id === plugin.id);
    if (!regions.length) continue;
    const placed = placeRegions(current, regions);
    if (placed.missing.length) {
      for (const region of placed.missing) {
        edit.manual.push({
          path: file.path,
          slot: region.slot,
          text: region.text,
          reason:
            current === null
              ? `${file.path} does not exist`
              : `${file.path} has no anchor 'manablox:slot ${region.slot}'`,
        });
      }
      continue;
    }
    if (placed.content === current) edit.unchanged.push(file.path);
    else edit.writes.set(file.path, { path: file.path, content: placed.content });
  }
  return edit;
}

/** Every region at its anchor; all or nothing per file. */
function placeRegions(
  current: string | null,
  regions: readonly Region[],
): { content: string; missing: Region[] } {
  if (current === null) return { content: '', missing: [...regions] };
  let content = current;
  const missing: Region[] = [];
  for (const region of regions) {
    if (!region.slot) {
      missing.push(region);
      continue;
    }
    const result = insertRegion(content, region.slot, region);
    if (result.status === 'missing') missing.push(region);
    else content = result.content;
  }
  return { content: missing.length ? current : content, missing };
}

/**
 * Takes a plugin's parts out of an instance: every marked region of its id in the files a
 * new instance has, its whole files, its dependencies and scripts. `plugin` is `null` when
 * its contribution cannot be loaded: then only the regions and `packages` go.
 */
export function planUninstall(
  dir: string,
  options: CreateOptions,
  secrets: Secrets,
  id: string,
  plugin: InstancePlugin | null,
  packages: readonly string[],
): PluginEdit {
  const edit = emptyEdit();
  const both = plugin ? renderBoth(options, secrets, plugin) : null;
  const core = both?.core ?? renderFiles(options, secrets, []);
  const ownFiles = (plugin?.templates.files ?? []).map((file) => file.path);
  for (const path of ownFiles) if (read(dir, path) !== null) edit.deletes.push(path);

  for (const file of core) {
    if (file.path === 'package.json' || ownFiles.includes(file.path)) continue;
    const current = read(dir, file.path);
    if (current === null) continue;
    try {
      const { content, removed } = removeRegions(current, id);
      if (removed) edit.writes.set(file.path, { path: file.path, content });
    } catch (error) {
      if (!(error instanceof UnbalancedRegion)) throw error;
      edit.manual.push({
        path: file.path,
        slot: null,
        text: '',
        reason: `${file.path}: ${error.message}; remove the ${id} part by hand`,
      });
    }
  }

  const current = read(dir, 'package.json');
  if (current !== null) {
    let manifest: Manifest | null = null;
    try {
      manifest = parse(current);
    } catch {
      edit.manual.push({
        path: 'package.json',
        slot: null,
        text: packages.join('\n'),
        reason: 'package.json is not valid JSON; remove these dependencies',
      });
    }
    if (manifest) {
      const drop = new Set([...packages, ...Object.keys(plugin?.templates.dependencies ?? {})]);
      const added = both
        ? Object.keys(
            parse(both.withPlugin.find((entry) => entry.path === 'package.json')?.content ?? '{}')
              .scripts ?? {},
          ).filter(
            (name) =>
              !Object.hasOwn(
                parse(core.find((entry) => entry.path === 'package.json')?.content ?? '{}')
                  .scripts ?? {},
                name,
              ),
          )
        : [];
      const next: Manifest = { ...manifest };
      if (manifest.dependencies) {
        next.dependencies = reordered(
          Object.entries(manifest.dependencies).filter(([name]) => !drop.has(name)),
        );
      }
      if (manifest.scripts && added.length) {
        next.scripts = reordered(
          Object.entries(manifest.scripts).filter(([name]) => !added.includes(name)),
        );
      }
      const text = manifestText(next);
      if (text !== current)
        edit.writes.set('package.json', { path: 'package.json', content: text });
    }
  }
  return edit;
}
