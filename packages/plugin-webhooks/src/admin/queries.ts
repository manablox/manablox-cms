import { required, type SpaceRef, spaceWrites, useSpacePagedQuery } from '@manablox/admin-sdk';
import { type MaybeRefOrGetter, toValue } from 'vue';
import type { WebhookDirection } from '../sdk';
import { webhooksApi as api } from './client';
import { invalidateWebhooks, webhookKeys as keys } from './keys';
import { useWorkflowsApi } from './useWorkflowsApi';

/** An endpoint as the list and the dialog show it. */
export type Webhook = Awaited<ReturnType<typeof api.get>>;

/** Calls per page of an endpoint's log. */
export const DELIVERY_PAGE_SIZE = 20;

/** Webhooks per page of the list. */
export const WEBHOOK_PAGE_SIZE = 25;

/** One page of a space's webhooks of one direction. */
export function useWebhookPage(direction: MaybeRefOrGetter<WebhookDirection>, spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (space, page) =>
      keys.page(space, { direction: toValue(direction), page, limit: WEBHOOK_PAGE_SIZE }),
    (space, pagination) => api.list({ spaceId: space, direction: toValue(direction), pagination }),
    { spaceId, pageSize: WEBHOOK_PAGE_SIZE, resetOn: [() => toValue(direction)] },
  );
}

/** A page of an endpoint's calls, newest first, fetched while it is open. */
export function useDeliveries(id: MaybeRefOrGetter<string | null>, spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (space, page) => keys.deliveryPage(space, toValue(id), { page }),
    (space, pagination) =>
      api.deliveries({ spaceId: space, id: required(toValue(id)), pagination }),
    {
      spaceId,
      pageSize: DELIVERY_PAGE_SIZE,
      resetOn: [() => toValue(id)],
      enabled: () => Boolean(toValue(id)),
    },
  );
}

/** The space's endpoints and what lists them, such as the workflow editor's catalogue. */
function invalidateSpace(spaceId: string): void {
  invalidateWebhooks(spaceId);
  useWorkflowsApi()?.invalidateCatalog(spaceId);
}

const write = spaceWrites(invalidateSpace);

type WebhookInput = Parameters<typeof api.create>[0];

/** Webhook writes, each with its invalidation. */
export const webhooks = {
  create: write.withInput((input: WebhookInput) => api.create(input)),
  update: write.withInput((input: WebhookInput & { id: string }) => api.update(input)),
  setEnabled: write.withSpace((spaceId: string, id: string, enabled: boolean) =>
    api.setEnabled({ spaceId, id, enabled }),
  ),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.delete({ spaceId, id });
  }),
  /** Sends a test call. */
  test: write.withSpace((spaceId: string, id: string) => api.test({ spaceId, id })),
  /** Sends one logged call again. Outgoing only. */
  retry: write.withSpace((spaceId: string, id: string, deliveryId: string) =>
    api.retry({ spaceId, id, deliveryId }),
  ),
};
