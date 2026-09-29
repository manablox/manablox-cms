import { PRODUCTION_ENVIRONMENT } from '@manablox/core';
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  activeEnvironment,
  ENV_QUERY,
  environmentOf,
  queryEnvironment,
  setEnvironment,
} from '../../lib/environment';
import { useFeature } from '../../lib/space';
import { useSpaceStore } from '../../stores/space';
import { isProduction, switchPath } from './model';
import { type Environment, useEnvironments } from './queries';

/** The current space's environment: `?env=` in the URL, production without it. */
export function useEnvironment() {
  const spaces = useSpaceStore();
  const route = useRoute();
  const router = useRouter();
  const feature = useFeature('environments');
  const list = useEnvironments({ enabled: () => !feature.value.hidden });

  const machineName = computed(() => environmentOf(spaces.currentId));
  const production = computed(() => isProduction(machineName.value));
  const current = computed<Environment | null>(
    () => list.data.value?.find((row) => row.machineName === machineName.value) ?? null,
  );

  /** Switches the admin to `target`, landing on a page that exists there. */
  async function switchTo(target: string): Promise<void> {
    if (target === machineName.value) return;
    const row = list.data.value?.find((environment) => environment.machineName === target);
    setEnvironment(spaces.currentId, target, row?.id ?? null);
    const { [ENV_QUERY]: _env, ...query } = route.query;
    const path = switchPath(route);
    await router.push({
      path,
      query: {
        ...(path === route.path ? query : {}),
        ...(isProduction(target) ? {} : { [ENV_QUERY]: target }),
      },
    });
  }

  return {
    /** The machine name; `production` without `?env=`. */
    machineName,
    production,
    /** The environment's row, once the list is loaded. */
    current,
    environments: list,
    feature,
    switchTo,
  };
}

/**
 * Keeps the environment in step, once per shell: a space switch goes back to production, and
 * an environment that is gone or switched off falls back to production too.
 */
export function useEnvironmentSync(): void {
  const spaces = useSpaceStore();
  const route = useRoute();
  const router = useRouter();
  const { environments, feature, machineName } = useEnvironment();

  function toProduction(): void {
    setEnvironment(null, null);
    if (!queryEnvironment(route.query)) return;
    const { [ENV_QUERY]: _env, ...query } = route.query;
    void router.replace({ path: switchPath(route), query });
  }

  watch(
    () => spaces.currentId,
    (next, previous) => {
      // The first space of the session keeps the URL's environment.
      if (previous === null || previous === undefined) {
        setEnvironment(next, queryEnvironment(route.query));
        return;
      }
      if (next !== previous) toProduction();
    },
  );

  watch(
    [() => environments.data.value, () => feature.value.enabled, machineName],
    ([list, enabled, name]) => {
      if (name === PRODUCTION_ENVIRONMENT) return;
      if (!enabled) return toProduction();
      if (!list) return;
      const row = list.find((environment) => environment.machineName === name);
      if (!row) return toProduction();
      const active = activeEnvironment.value;
      if (active && active.id !== row.id) setEnvironment(active.spaceId, name, row.id);
    },
    { immediate: true },
  );
}
