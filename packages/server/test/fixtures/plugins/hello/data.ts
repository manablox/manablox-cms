import type { PluginResourceEntry } from '@manablox/core';
import { stableId } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import {
  defineDataProvider,
  defineResourceKind,
  type ResourceKindPlan,
  rowsSection,
} from '@manablox/services';
import { type HelloGreetingRow, helloRepos } from './db.js';
import { helloKeys, shouted } from './services.js';

/** A greeting in a space export or snapshot. */
interface ExportedGreeting {
  id: string;
  message: string;
  createdAt: string;
}

/** A greeting declared in code, as the config export writes it. */
interface GreetingDefinition extends PluginResourceEntry {
  message: string;
}

const exported = (row: HelloGreetingRow): ExportedGreeting => ({
  id: row.id,
  message: row.message,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The id an exported greeting is written under in `spaceId`: derived, so an export imports
 * beside its space, and other providers find it through the import's `ids`.
 */
const greetingTargetId = (id: string, spaceId: string) => stableId(spaceId, id);

/** Writes greetings into the space's production. */
async function insertGreetings(
  repos: Repositories,
  spaceId: string,
  entries: ExportedGreeting[],
): Promise<void> {
  const environment = await repos.environments.findByMachineName(spaceId, 'production');
  if (!environment) return;
  await helloRepos(repos).greetings.insert(
    entries.map((entry) => ({
      id: greetingTargetId(entry.id, spaceId),
      spaceId,
      environmentId: environment.id,
      message: entry.message,
      createdAt: new Date(entry.createdAt),
    })),
  );
}

/**
 * Greetings move like documents: full copies and promotes, transfers and snapshots. Shouted
 * ones stay on the instance, so one provider covers both the export and the snapshot state:
 * exports leave them out, snapshots keep them.
 */
export const helloData = defineDataProvider<HelloGreetingRow, ExportedGreeting, ExportedGreeting[]>(
  {
    kind: 'hello.greetings',
    environments: {
      content: true,
      load: ({ repos, spaceId, environmentId }) =>
        helloRepos(repos).greetings.list({ spaceId, environmentId }),
      describe: (row) => ({ label: row.message, value: row.message }),
      copy: ({ repos, rows }) => helloRepos(repos).greetings.insert(rows),
      async promote({ repos, upsert, remove, production }) {
        const { greetings } = helloRepos(repos);
        const live = new Set(production.map((row) => row.id));
        for (const row of remove) await greetings.remove(row.id);
        for (const row of upsert.filter((entry) => live.has(entry.id))) {
          await greetings.update(row.id, row.message);
        }
        await greetings.insert(upsert.filter((row) => !live.has(row.id)));
      },
      limits: ({ upsert, remove, production }) => {
        const live = new Set(production.map((row) => row.id));
        const added = upsert.filter((row) => !live.has(row.id)).length;
        return { [helloKeys.limits.greetings]: added - remove.length };
      },
      onLiveChange: ({ plugin, spaceId, reason }) => {
        plugin?.plugins.get('hello')?.live.push({ spaceId, reason });
      },
    },
    transfer: {
      section: { label: 'Greetings' },
      // Listed, they can be picked one by one.
      ...rowsSection({
        list: async ({ repos }, scope) =>
          (await helloRepos(repos).greetings.list(scope)).filter((row) => !shouted(row.message)),
        label: (row) => row.message,
        toExported: exported,
      }),
      targetId: greetingTargetId,
      limits: (entries) => ({ [helloKeys.limits.greetings]: entries.length }),
      import: ({ repos, spaceId }, entries) => insertGreetings(repos, spaceId, entries),
    },
    snapshot: {
      capture: async ({ repos, spaceId }) =>
        (await helloRepos(repos).greetings.list(spaceId))
          .filter((row) => shouted(row.message))
          .map(exported),
      limits: (entries) => ({ [helloKeys.limits.greetings]: entries.length }),
      restore: ({ repos, spaceId }, entries) => insertGreetings(repos, spaceId, entries),
    },
    counters: {
      [helloKeys.limits.greetings]: ({ repos }, spaceIds) =>
        helloRepos(repos).greetings.countForSpaces(spaceIds),
    },
  },
);

/** The `hello.greeting` resource kind: the config export writes greetings as `defineGreeting`. */
export const helloGreetingKind = defineResourceKind<
  GreetingDefinition,
  unknown,
  ResourceKindPlan,
  HelloGreetingRow
>({
  configExport: {
    label: 'Greetings',
    description: 'defineGreeting, one per greeting of production.',
    icon: 'star',
    define: { name: 'defineGreeting', from: 'hello-plugin/define' },
    load: async ({ repos, spaceId }) =>
      (await helloRepos(repos).greetings.list(spaceId)).map((row) => ({
        id: row.id,
        label: row.message,
        slug: '',
        row,
      })),
    render: (row, { slug }) => ({ input: { slug, message: row.message } }),
  },
});
