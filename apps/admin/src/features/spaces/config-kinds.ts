import type { api } from '@manablox/admin-sdk/lib/api';

/** What a space can write as config source, per kind. */
export type ConfigInventory = Awaited<ReturnType<typeof api.spaces.configInventory>>;

/** A core part of a `manablox.config.ts`. */
type CoreConfigKind = Exclude<keyof ConfigInventory, 'plugins'>;

/** One part of a `manablox.config.ts`: a core kind or a data provider's. */
export type ConfigKind = CoreConfigKind | (string & Record<never, never>);

export interface ConfigKindMeta {
  id: ConfigKind;
  label: string;
  description: string;
  icon: string;
}

/** Config kinds in the generated file's order. */
const CONFIG_KINDS: ConfigKindMeta[] = [
  {
    id: 'contentTypes',
    label: 'Content types',
    description: 'defineContentType, with every field and its admin layout.',
    icon: 'blocks',
  },
  {
    id: 'credentials',
    label: 'Credentials',
    description: 'defineCredential: the slot only. Secrets are filled from the environment.',
    icon: 'key',
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'defineTemplate, with the blocks of every locale it was written in.',
    icon: 'template',
  },
];

/** Core kinds, then the providers' kinds the inventory lists. */
export function configKinds(inventory: ConfigInventory | null | undefined): ConfigKindMeta[] {
  return [
    ...CONFIG_KINDS,
    ...(inventory?.plugins ?? []).map((kind) => ({
      id: kind.kind,
      label: kind.label,
      description: kind.description ?? `Entries of the ${kind.kind} resource kind.`,
      icon: kind.icon ?? 'plug',
    })),
  ];
}

/** The entries of a kind the inventory holds. */
export function kindEntries(
  inventory: ConfigInventory | null | undefined,
  kind: ConfigKind,
): Array<{ id: string; label: string }> {
  if (!inventory) return [];
  const provider = inventory.plugins.find((entry) => entry.kind === kind);
  return provider ? provider.entries : (inventory[kind as CoreConfigKind] ?? []);
}

/** Kinds and entries to write. */
export interface ConfigSelection {
  kinds: ConfigKind[];
  ids: Partial<Record<ConfigKind, string[]>>;
}

export const everyKind = (): ConfigSelection => ({
  kinds: CONFIG_KINDS.map((kind) => kind.id),
  ids: {},
});

/** The selection as the RPC takes it; an empty `ids` key means the whole kind. */
export function configPayload(selection: ConfigSelection): {
  kinds?: ConfigKind[];
  ids?: Record<string, string[]>;
} {
  const ids = Object.fromEntries(
    Object.entries(selection.ids).flatMap(([kind, entries]) =>
      entries && selection.kinds.includes(kind) ? [[kind, entries]] : [],
    ),
  );
  return {
    ...(selection.kinds.length ? { kinds: selection.kinds } : {}),
    ...(Object.keys(ids).length ? { ids } : {}),
  };
}

/** `3 content types, 2 templates`; `kinds` names the providers' kinds too. */
export function describeKinds(
  counts: Partial<Record<ConfigKind, number>>,
  kinds: readonly ConfigKindMeta[] = CONFIG_KINDS,
): string {
  const parts = kinds
    .filter((kind) => counts[kind.id])
    .map((kind) => {
      const count = counts[kind.id] as number;
      const label = kind.label.toLowerCase();
      return `${count} ${count === 1 ? singular(label) : label}`;
    });
  return parts.join(', ');
}

const singular = (label: string) => (label.endsWith('s') ? label.slice(0, -1) : label);
