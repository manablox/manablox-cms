# `@manablox/plugin-webhooks`

Webhooks for Manablox, as a plugin: outgoing calls to another system when content changes,
and incoming endpoints other systems call, which start and stop workflows.

- **Outgoing webhooks**: a URL and the content events it hears about (created, updated, saved, deleted, published, unpublished). Deliveries are queued as `webhooks:deliver` jobs and retried.
- **Incoming webhooks**: an address other systems call, `/plugins/webhooks/in/<space id>/<slug>` on the management server (a staging environment's names it in between: `/plugins/webhooks/in/<space id>/<environment>/<slug>`). Unauthenticated: the endpoint's own check (signature, token, basic or bearer) decides. The raw body is kept for signatures, calls are rate limited per client address, and the answer is `202`.
- **The log**: every call, either direction, rejected ones included; the newest 200 per endpoint.
- **With workflows** (`@manablox/plugin-workflows`): the `webhook` trigger and abort trigger, so a call starts every workflow waiting on the endpoint or stops runs, and **Connect to workflow** on an incoming endpoint's row.
- **Without workflows**: incoming calls are still received, checked, logged and handed to the `webhooks:received` hook; nothing runs them unless a plugin listens.
- **Endpoints in code**: `defineWebhook`, either direction, reconciled into every space by `manablox sync`.

## Install

```sh
npm install @manablox/plugin-webhooks
```

A project made with `manablox create` has it when webhooks were picked as a feature
(`--webhooks`, or `webhooks` in `--features`); nothing is preselected. Add it to an existing
project with `manablox plugin install webhooks`.

## Usage

Add the plugin to the management instance's config, next to the workflows plugin if you
use workflows. The public (delivery) config does not need it.

```ts
import { defineConfig } from '@manablox/core';
import { webhooksPlugin } from '@manablox/plugin-webhooks';
import { workflowsPlugin } from '@manablox/plugin-workflows';

export default defineConfig({
  // database, auth, storage ...
  plugins: [workflowsPlugin(), webhooksPlugin()],
});
```

It has no options. Run `manablox migrate` afterwards: the plugin's baseline migration
creates its tables, `webhooks` and `webhooks_deliveries`.

## In code

```ts
import { defineConfig } from '@manablox/core';
import { defineWebhook, webhookTrigger } from '@manablox/plugin-webhooks/define';
import { defineWorkflow } from '@manablox/plugin-workflows/define';

export default defineConfig({
  // ...
  resources: {
    plugins: {
      'webhooks.webhook': [
        defineWebhook({ slug: 'from-github', direction: 'incoming', auth: { mode: 'hmac', credential: 'github' } }),
      ],
      'workflows.workflow': [
        defineWorkflow({
          slug: 'on-push',
          trigger: webhookTrigger('from-github'),
          steps: [{ key: 'notify', action: 'email', config: { to: ['team@example.com'], subject: 'Pushed', body: '{{ payload.body.ref }}' } }],
        }),
      ],
    },
  },
});
```

`webhookAbort('<slug>', { match })` is the abort trigger of the same endpoint in `abortOn`.

## From another plugin

```ts
import type {} from '@manablox/plugin-webhooks';

// in a plugin's setup or hooks
manablox.hooks.on('webhooks:received', async ({ webhook, payload, headers }) => {
  // a verified incoming call; errors are logged, never answered
});

const service = manablox.plugins.get('webhooks')?.webhooks; // WebhookService
```

`webhooks:beforeCreate` (`{ spaceId, direction, name }`) runs before an endpoint is
created, imports included; throw to refuse it.

## What it adds

- Permissions `webhooks:read` (editors) and `webhooks:write`.
- The flag `features.plugins.webhooks`, `limits.plugins.webhooks.count`, `rateLimits.plugins.webhooks.incoming` (600 a minute per client address by default) and `.outgoing`, `retention.plugins.webhooks.deliveriesDays`.
- Procedures `plugins.webhooks.*` (`list`, `get`, `create`, `update`, `setEnabled`, `delete`, `deliveries`, `retry`, `test`).
- The hooks `webhooks:beforeCreate` and `webhooks:received`, the job `webhooks:deliver`.
- Audit kind `webhooks.webhook`, error keys `plugins.webhooks.*`.
- The code resource kind `webhooks.webhook` and the transfer section `webhooks.webhooks`.
- The Webhooks page of the admin, loaded at runtime.
- `WebhookService` and its types from `@manablox/plugin-webhooks`; browser-safe types and constants (`WEBHOOK_DIRECTIONS`, `WEBHOOK_AUTH_MODES`, ...) from `@manablox/plugin-webhooks/sdk`.
