import { computed, ref, watch } from 'vue';
import { useEnvironment } from './useEnvironment';

/**
 * The environment a new domain or host goes into: the open one unless another is picked.
 * `choosable` is false while the space has only production or the feature is off.
 */
export function useEnvironmentChoice() {
  const { machineName, current, environments, feature } = useEnvironment();
  const target = ref(machineName.value);
  watch(machineName, (name) => {
    target.value = name;
  });

  const options = computed(() =>
    (environments.data.value ?? []).map((environment) => ({
      value: environment.machineName,
      label: environment.name,
      hint: environment.machineName,
    })),
  );
  const choosable = computed(() => feature.value.enabled && options.value.length > 1);
  const nameOf = (machine: string) =>
    environments.data.value?.find((environment) => environment.machineName === machine)?.name ??
    machine;

  return {
    target,
    options,
    choosable,
    /** The open environment's name, for the rows it lists. */
    currentName: computed(() => current.value?.name ?? machineName.value),
    /** Whether the badge is worth showing. */
    labelled: computed(() => options.value.length > 1),
    machineName,
    nameOf,
  };
}
