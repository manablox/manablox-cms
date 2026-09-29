import { ref } from '@manablox/core';
import { defineWorkflow } from '@manablox/plugin-workflows/define';
import { describe, expect, it } from 'vitest';
import {
  defineWebhook,
  WEBHOOK_RESOURCE_KIND,
  webhookAbort,
  webhookTrigger,
} from '../src/define.js';

describe('defineWebhook', () => {
  it('fills the direction-specific half and leaves the other empty', () => {
    const outgoing = defineWebhook({ slug: 'ping', direction: 'outgoing', url: 'https://x.test' });
    expect(outgoing).toMatchObject({ url: 'https://x.test', methods: [] });

    const incoming = defineWebhook({ slug: 'from-github', direction: 'incoming' });
    expect(incoming).toMatchObject({ url: '', methods: ['POST'] });
  });

  it('points its auth at a credential slug', () => {
    const hook = defineWebhook({
      slug: 'from-github',
      direction: 'incoming',
      auth: { mode: 'hmac', credential: 'github' },
    });
    expect(hook.auth).toMatchObject({ mode: 'hmac', credentialId: ref.credential('github') });
  });

  it('refuses authentication a direction cannot do, and a mode with nothing behind it', () => {
    expect(() =>
      defineWebhook({
        slug: 'in',
        direction: 'incoming',
        auth: { mode: 'oauth2', credential: 'a' },
      }),
    ).toThrow(/modeUnsupported/);
    expect(() =>
      defineWebhook({ slug: 'in', direction: 'incoming', auth: { mode: 'hmac' } }),
    ).toThrow(/credentialRequired/);
    expect(() => defineWebhook({ slug: 'out', direction: 'outgoing' })).toThrow(/url.required/);
  });
});

describe('webhookTrigger', () => {
  it('names an incoming endpoint by slug', () => {
    const workflow = defineWorkflow({
      slug: 'from-github',
      trigger: webhookTrigger('github-push'),
      steps: [{ key: 'go', action: 'http' }],
    });
    expect(workflow.trigger).toEqual({
      kind: 'webhook',
      webhookId: ref.of(WEBHOOK_RESOURCE_KIND, 'github-push'),
      filter: null,
    });
  });

  it('names the endpoint of an abort trigger by slug, with its match', () => {
    const workflow = defineWorkflow({
      slug: 'guarded',
      trigger: { kind: 'event', events: ['content.saved'] },
      abortOn: [
        webhookAbort('from-github', {
          match: { key: { run: '{{ content.id }}', abort: '{{ payload.body.id }}' } },
        }),
      ],
      steps: [{ key: 'go', action: 'http' }],
    });
    expect(workflow.abortTriggers).toEqual([
      {
        id: expect.any(String),
        kind: 'webhook',
        webhookId: ref.of(WEBHOOK_RESOURCE_KIND, 'from-github'),
        filter: null,
        match: { mode: 'key', runKey: '{{ content.id }}', abortKey: '{{ payload.body.id }}' },
      },
    ]);
  });
});
