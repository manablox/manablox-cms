import type { CliSpaceCreateOptions, CliValues } from '@manablox/core';
import type { CliPlugin } from '../plugins.js';
import type { SpaceOptions } from './options.js';

type Report = (space: { url: string; warnings: readonly string[] }) => string[];

/**
 * The plugins' data for `spaces.create`: `--plugin-data` plus what each plugin makes of its
 * own options. A plugin given data both ways is refused.
 */
export async function pluginSpaceData(
  options: SpaceOptions,
  plugins: readonly CliPlugin[],
  valuesOf: (group: CliSpaceCreateOptions) => CliValues,
): Promise<{ plugins: Record<string, unknown>; reports: Report[] }> {
  const data: Record<string, unknown> = { ...options.pluginData };
  const reports: Report[] = [];
  const space = {
    name: options.name,
    machineName: options.machineName,
    url: options.url,
    locales: options.locales,
  };
  const groups = plugins.flatMap((plugin) => {
    const group = plugin.contribution.options?.['space create'];
    return group ? [{ id: plugin.id, group, values: valuesOf(group) }] : [];
  });
  for (const { group, values } of groups) await group.check?.(values);
  for (const { id, group, values } of groups) {
    const value = await group.apply(space, values);
    if (value === undefined) continue;
    if (Object.hasOwn(data, id)) {
      const given = Object.keys(values)
        .map((name) => `--${name}`)
        .join(', ');
      throw new Error(
        `${given} and --plugin-data ${id}=... both give the ${id} plugin's data; use one`,
      );
    }
    data[id] = value;
    const { report } = group;
    if (report) reports.push((created) => report(value, created));
  }
  return { plugins: data, reports };
}
