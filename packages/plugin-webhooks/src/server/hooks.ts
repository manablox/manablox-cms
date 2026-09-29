import type { HookContextBase } from '@manablox/core';
import type { WebhookDirection, WebhookPayload } from '../sdk.js';

/** A verified incoming call, as `webhooks:received` hands it on. */
export interface WebhookReceived {
  webhook: { id: string; spaceId: string; environmentId: string; name: string; slug: string };
  payload: WebhookPayload;
  /** Lower-cased request headers, secret-bearing ones removed. */
  headers: Record<string, string>;
}

declare module '@manablox/core' {
  interface ManabloxHooks {
    /** Before an endpoint is created, imports included; throw to refuse it. */
    'webhooks:beforeCreate': [
      { spaceId: string; direction: WebhookDirection; name: string },
      HookContextBase,
    ];
    /**
     * After an incoming call passed its checks and before it is answered, for plugins that act
     * on calls; handlers' errors are logged, never answered.
     */
    'webhooks:received': [WebhookReceived, HookContextBase];
  }
}
