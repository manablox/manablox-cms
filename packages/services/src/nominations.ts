import { type EnvironmentNomination, nominationOf, withStagingNominations } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceRow } from '@manablox/db';
import { environmentNominations } from './data/registry.js';

type Settings = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * Every environment's nominations of a space: core ones in `spaces.settings`, a plugin's in
 * its settings rows, production's through the nomination's `read` and `write`, a staging
 * environment's at its key.
 */
export class SpaceNominations {
  readonly list: readonly EnvironmentNomination[];
  private settings: Settings;
  /** Plugin settings by environment id, then plugin id. */
  private readonly rows = new Map<string, Map<string, Settings>>();
  private readonly changedRows = new Set<string>();

  private constructor(
    manablox: Pick<Manablox, 'config'>,
    readonly space: SpaceRow,
    private readonly productionId: string,
    rows: Array<{ environmentId: string; plugin: string; data: Settings }>,
  ) {
    this.list = environmentNominations(manablox);
    this.settings = space.settings;
    for (const row of rows) this.plugins(row.environmentId).set(row.plugin, row.data);
  }

  /** The space's nominations; `null` for a missing space. */
  static async load(
    manablox: Pick<Manablox, 'config'>,
    repos: Repositories,
    spaceId: string,
  ): Promise<SpaceNominations | null> {
    const space = await repos.spaces.findById(spaceId);
    if (!space) return null;
    const plugins = new Set(environmentNominations(manablox).flatMap((n) => n.plugin ?? []));
    // Core nominations live on the space row alone.
    if (plugins.size === 0) return new SpaceNominations(manablox, space, '', []);
    const production = await repos.environments.production(spaceId);
    if (!production) return null;
    const rows = (await repos.pluginSettings.listBySpace(spaceId)).filter((row) =>
      plugins.has(row.plugin),
    );
    return new SpaceNominations(manablox, space, production.id, rows);
  }

  /** An environment's document; `stagingId` null is production. */
  get(stagingId: string | null, nomination: EnvironmentNomination): string | null {
    if (!nomination.plugin) return nominationOf(this.settings, stagingId, nomination);
    const data = this.data(stagingId, nomination.plugin);
    if (!data) return null;
    return stagingId ? text(data[nomination.key]) : nomination.read(data);
  }

  /** Sets an environment's document; `null` clears it. */
  set(stagingId: string | null, nomination: EnvironmentNomination, id: string | null): void {
    if (this.get(stagingId, nomination) === id) return;
    if (!nomination.plugin) {
      this.settings = stagingId
        ? withStagingNominations(this.settings, stagingId, { [nomination.key]: id })
        : nomination.write(this.settings, id);
      return;
    }
    const environmentId = stagingId ?? this.productionId;
    const data = this.data(stagingId, nomination.plugin) ?? {};
    let next: Settings;
    if (stagingId) {
      const { [nomination.key]: _previous, ...rest } = data;
      next = id ? { ...rest, [nomination.key]: id } : rest;
    } else {
      next = nomination.write(data, id);
    }
    this.plugins(environmentId).set(nomination.plugin, next);
    this.changedRows.add(`${environmentId}\n${nomination.plugin}`);
  }

  /** Staging environments naming any document. */
  stagingIds(): string[] {
    const ids = new Set(Object.keys((this.settings.environments as Settings | undefined) ?? {}));
    for (const id of this.rows.keys()) if (id !== this.productionId) ids.add(id);
    return [...ids];
  }

  /** Space settings with a staging environment's core nominations in production's place. */
  settingsAsProduction(stagingId: string): Settings {
    const { environments: _environments, ...rest } = this.settings;
    let out: Settings = rest;
    for (const nomination of this.list) {
      if (!nomination.plugin) out = nomination.write(out, this.get(stagingId, nomination));
    }
    return out;
  }

  /** A plugin's settings of an environment with its nominations in production's place. */
  pluginSettingsAsProduction(stagingId: string | null, plugin: string): Settings | null {
    const production = this.data(null, plugin);
    if (!stagingId) return production;
    let out: Settings = production ?? {};
    for (const nomination of this.list) {
      if (nomination.plugin === plugin) {
        out = nomination.write(out, this.get(stagingId, nomination));
      }
    }
    return production || Object.keys(out).length ? out : null;
  }

  /** Writes what changed. */
  async save(repos: Repositories): Promise<void> {
    if (this.settings !== this.space.settings) {
      await repos.spaces.update(this.space.id, { settings: this.settings });
    }
    for (const key of this.changedRows) {
      const [environmentId = '', plugin = ''] = key.split('\n');
      const data = this.plugins(environmentId).get(plugin) ?? {};
      const scope = { spaceId: this.space.id, environmentId };
      if (environmentId !== this.productionId && Object.keys(data).length === 0) {
        await repos.pluginSettings.remove(scope, plugin);
      } else {
        await repos.pluginSettings.set(scope, plugin, data);
      }
    }
    this.changedRows.clear();
  }

  private plugins(environmentId: string): Map<string, Settings> {
    let own = this.rows.get(environmentId);
    if (!own) {
      own = new Map();
      this.rows.set(environmentId, own);
    }
    return own;
  }

  private data(stagingId: string | null, plugin: string): Settings | null {
    return this.rows.get(stagingId ?? this.productionId)?.get(plugin) ?? null;
  }
}
