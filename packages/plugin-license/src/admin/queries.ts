import { useSessionStore } from '@manablox/admin-sdk';
import { useQuery } from '@tanstack/vue-query';
import { licenseApi } from './client';
import { invalidateLicenses, licenseKeys } from './keys';

/** The instance's keys, the products its plugins sell and the portal. */
export function useLicenseOverview() {
  return useQuery({ queryKey: licenseKeys.overview(), queryFn: () => licenseApi.overview() });
}

/** After a write: the list, and the session, whose locks and banners follow the licenses. */
async function written<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  invalidateLicenses();
  void useSessionStore().revalidate(true);
  return value;
}

/** Key writes, each with its invalidation. */
export const licenses = {
  add: (key: string) => written(licenseApi.addKey({ key })),
  remove: (id: string) => written(licenseApi.removeKey({ id })),
  refresh: (id: string) => written(licenseApi.refresh({ id })),
  activate: (id: string) => written(licenseApi.activate({ id })),
  deactivate: (id: string) => written(licenseApi.deactivate({ id })),
};
