import { pluginClient, useSpaceStore } from '@manablox/admin-sdk';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { HelloRouter } from '../../../../../api/src/e2e/runtime-plugins';

const hello = pluginClient<HelloRouter>('hello');

/** The current space's greetings. */
export function useGreetings() {
  const spaces = useSpaceStore();
  return useQuery({
    queryKey: computed(() => ['hello', 'greetings', spaces.currentId]),
    queryFn: () => hello.greetings.list({ spaceId: spaces.currentId as string }),
    enabled: computed(() => Boolean(spaces.currentId)),
  });
}
