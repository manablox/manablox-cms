import { QueryCache, QueryClient } from '@tanstack/vue-query';
import { useSessionStore } from '../stores/session';
import { errorKey } from './api-errors';
import { suspension } from './control-messages';

/** The query cache, created here so Pinia stores can reach it outside injection context. */
export const queryClient = new QueryClient({
  // A read refused because the instance is suspended refetches the session, so the panel shows.
  queryCache: new QueryCache({
    onError: (error) => {
      if (errorKey(error) !== 'control.suspended') return;
      const session = useSessionStore();
      if (suspension(session.me) === null) void session.revalidate(true);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
