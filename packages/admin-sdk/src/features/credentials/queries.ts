import { useSpacePagedQuery } from '../../composables/usePagedQuery';
import { api } from '../../lib/api';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import { type SpaceRef, useSpaceQuery } from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

/** The server's ceiling for a credential page; what a picker lists. */
const WHOLE_LIST = 500;

/** Credentials per page of the settings list. */
export const CREDENTIAL_PAGE_SIZE = 25;

/** The space's credentials for a picker, without secrets. */
export function useCredentials(spaceId?: SpaceRef) {
  return useSpaceQuery(
    keys.credentials.list,
    async (id) =>
      (await api.credentials.list({ spaceId: id, pagination: { limit: WHOLE_LIST } })).items,
    { spaceId },
  );
}

/** One page of the space's credentials. */
export function useCredentialPage(spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (space, page) => keys.credentials.page(space, { page }),
    (space, pagination) => api.credentials.list({ spaceId: space, pagination }),
    { spaceId, pageSize: CREDENTIAL_PAGE_SIZE },
  );
}

export type { CredentialKind, CredentialView } from '@manablox/core';

type CredentialInput = Parameters<typeof api.credentials.create>[0];

const write = spaceWrites(invalidate.credentials);

/** Credential writes, each with its invalidation. */
export const credentials = {
  create: write.withInput((input: CredentialInput) => api.credentials.create(input)),
  update: write.withInput((input: CredentialInput & { id: string }) =>
    api.credentials.update(input),
  ),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.credentials.delete({ spaceId, id });
  }),
};
