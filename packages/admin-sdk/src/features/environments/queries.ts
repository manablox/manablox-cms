import type { UseQueryReturnType } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { api } from '../../lib/api';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import { required, type SpaceRef, useSpaceQuery } from '../../lib/space-query';
import { useSpaceStore } from '../../stores/space';

type Client = typeof api.environments;

type EnvironmentView = Awaited<ReturnType<Client['list']>>[number];
/** Named here: the router's own view type is not exported. */
export interface Environment extends EnvironmentView {}
export type EnvironmentDiff = Awaited<ReturnType<Client['diff']>>;
export type PromoteResult = Awaited<ReturnType<Client['promote']>>;
type CreateResult = Awaited<ReturnType<Client['create']>>;
export type EnvironmentMode = 'config' | 'full';

/** A space's environments, production first. */
export function useEnvironments(
  options: { spaceId?: SpaceRef; enabled?: MaybeRefOrGetter<boolean> } = {},
): UseQueryReturnType<Environment[], Error> {
  return useSpaceQuery(keys.environments.list, (id) => api.environments.list({ spaceId: id }), {
    spaceId: options.spaceId,
    enabled: options.enabled,
    staleTime: 60_000,
  });
}

/** What promoting `environment` with `mode` would change in production. */
export function useEnvironmentDiff(
  environment: MaybeRefOrGetter<string | null>,
  mode: MaybeRefOrGetter<EnvironmentMode>,
  spaceId?: SpaceRef,
): UseQueryReturnType<EnvironmentDiff, Error> {
  return useSpaceQuery(
    (space) => keys.environments.diff(space, toValue(environment) ?? '', toValue(mode)),
    (space) =>
      api.environments.diff({
        spaceId: space,
        environment: required(toValue(environment)),
        mode: toValue(mode),
      }),
    { spaceId, enabled: () => Boolean(toValue(environment)), staleTime: 0, gcTime: 0 },
  );
}

/** Environment writes, each refreshing what it changed. */
export const environments = {
  async create(input: {
    spaceId: string;
    name: string;
    machineName: string;
    from: string;
    mode: EnvironmentMode;
  }): Promise<CreateResult> {
    const result = await api.environments.create(input);
    invalidate.environments(input.spaceId);
    return result;
  },

  async promote(
    spaceId: string,
    environment: string,
    mode: EnvironmentMode,
    confirm: boolean,
  ): Promise<PromoteResult> {
    const result = await api.environments.promote({ spaceId, environment, mode, confirm });
    invalidate.promoted(spaceId);
    // Nominations live on the space row.
    await useSpaceStore().refresh();
    return result;
  },

  async remove(spaceId: string, environment: string): Promise<void> {
    await api.environments.delete({ spaceId, environment });
    invalidate.environments(spaceId);
  },
};
