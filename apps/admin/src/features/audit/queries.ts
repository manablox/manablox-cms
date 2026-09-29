import { usePagedQuery } from '@manablox/admin-sdk/composables/usePagedQuery';
import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { type SpaceRef, useSpaceScope } from '@manablox/admin-sdk/lib/space-query';
import type { AuditCatalog } from '@manablox/core';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { type AuditFilterForm, type AuditSortState, PAGE_SIZE, toFilterInput } from './model';

export type { AuditVerification } from '@manablox/admin-sdk/lib/api-types';
export type { AuditCatalog };

export interface AuditListParams {
  filter: AuditFilterForm;
  sort: AuditSortState;
}

/** One page of a space's log, or the instance's for a superadmin; a new filter, sort or scope starts at the first page. */
export function useAuditEntries(
  params: MaybeRefOrGetter<AuditListParams>,
  scope: MaybeRefOrGetter<'space' | 'instance' | 'instance-only'> = 'space',
  spaceId?: SpaceRef,
) {
  const space = useSpaceScope({ spaceId });
  return usePagedQuery({
    pageSize: PAGE_SIZE,
    resetOn: [() => JSON.stringify(toValue(params)), () => toValue(scope), space.spaceId],
    queryKey: (page) => {
      const mode = toValue(scope);
      const shape = { ...toValue(params), page };
      return mode === 'space'
        ? keys.audit.list(space.spaceId.value, shape)
        : keys.audit.instance({ mode, ...shape });
    },
    enabled: () => toValue(scope) !== 'space' || space.enabled.value,
    // The log must always be fresh.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: (pagination) => {
      const { filter, sort } = toValue(params);
      const common = { filter: toFilterInput(filter), sort, pagination };
      const mode = toValue(scope);
      if (mode === 'space') return api.audit.list({ spaceId: space.required(), ...common });
      return api.audit.listInstance({ instanceOnly: mode === 'instance-only', ...common });
    },
  });
}

/** The filter's actions, actor kinds and target kinds. */
export function useAuditCatalog() {
  return useQuery({
    queryKey: keys.audit.catalog(),
    queryFn: () => api.audit.catalog(),
    staleTime: 60 * 60_000,
  });
}

export const audit = {
  /** Verifies the whole chain; superadmin only. */
  async verify() {
    const result = await api.audit.verify();
    invalidate.audit();
    return result;
  },
};
