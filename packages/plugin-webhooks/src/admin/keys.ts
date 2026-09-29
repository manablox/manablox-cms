import { pluginKeys } from '@manablox/admin-sdk';

type Params = Record<string, unknown>;

const webhooks = pluginKeys('webhooks');

/** Query keys of the webhooks plugin; `all` covers every one of a space. */
export const webhookKeys = {
  all: webhooks.all,
  page: (spaceId: string | null, params: Params) => webhooks.scoped(spaceId, 'list', params),
  deliveries: (spaceId: string | null, id: string | null) =>
    webhooks.scoped(spaceId, 'deliveries', id),
  deliveryPage: (spaceId: string | null, id: string | null, params: Params) =>
    webhooks.scoped(spaceId, 'deliveries', id, params),
};

/** A space's endpoints and their logs, with the open activity log. */
export const invalidateWebhooks = webhooks.invalidate;
