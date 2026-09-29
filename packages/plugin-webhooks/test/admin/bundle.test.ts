import { queryClient } from '@manablox/admin-sdk';
import {
  createTestSession,
  exposePluginApi,
  mockAdminApi,
  setupAdminTest,
} from '@manablox/admin-sdk/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import webhooks from '../../src/admin/index';
import { invalidateWebhooks, webhookKeys } from '../../src/admin/keys';
import WebhookList from '../../src/admin/pages/WebhookList.vue';
import { webhooks as actions } from '../../src/admin/queries';

const webhooksApi = {
  list: vi.fn(),
  setEnabled: vi.fn(async () => ({ id: 'h1', enabled: false })),
};
mockAdminApi({ plugins: { webhooks: webhooksApi } });

const S = 's1';

const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated ?? null;

const samples = [
  webhookKeys.page(S, { direction: 'incoming', page: 0 }),
  webhookKeys.deliveries(S, 'h'),
  webhookKeys.deliveryPage(S, 'h', { page: 0 }),
];

beforeEach(() => {
  setupAdminTest({ space: { id: S } });
  vi.clearAllMocks();
});

describe('the webhooks bundle', () => {
  it('adds the list page and its menu entry, behind the read permission', () => {
    expect(webhooks.routes).toEqual([
      expect.objectContaining({ path: 'webhooks', name: 'webhooks', section: '/webhooks' }),
    ]);
    expect(webhooks.menu).toEqual([
      expect.objectContaining({
        label: 'Webhooks',
        to: '/webhooks',
        icon: 'webhook',
        group: 'automation',
        permission: 'webhooks:read',
        shortcut: 'h',
      }),
    ]);
    expect(webhooks.features).toEqual({ 'plugins.webhooks': 'Webhooks' });
    expect(webhooks.permissionIcons).toEqual({ 'plugins.webhooks': 'webhook' });
    expect(webhooks.diffKinds).toEqual({ webhooks: 'Webhooks' });
  });

  it("transfers endpoints as its data provider's section", () => {
    expect(webhooks.transferSections).toEqual([
      expect.objectContaining({
        kind: 'webhooks.webhooks',
        group: 'integrations',
        noun: ['webhook', 'webhooks'],
      }),
    ]);
  });

  it('labels its audit entries', () => {
    const audit = webhooks.audit;
    expect(audit?.entities?.['webhooks.webhook']?.label).toBe('Webhook');
    expect(audit?.entities?.['webhooks.webhook']?.route?.('h1', null)).toBe('/webhooks');
    expect(audit?.actions?.['webhooks.webhook.received']).toBe('An incoming webhook was called');
    expect(audit?.actions?.['webhooks.webhook.test']).toBe('Sent a test call to a webhook');
    expect(audit?.verbs?.['webhooks.webhook.setEnabled']).toBe('Switched');
    const outcome = audit?.outcomes?.['webhooks.webhook.setEnabled'];
    expect(outcome?.(null, [{ path: 'enabled', from: true, to: false }])).toBe('off');
  });

  it("drops the space's endpoints on live events, a promote and a workflow import", () => {
    const refresh = () => {
      for (const key of samples) queryClient.setQueryData(key, {});
    };
    const stale = () => samples.every((key) => invalidated(key));

    refresh();
    webhooks.realtime?.['webhooks.webhook']?.({ spaceId: S } as never);
    expect(stale()).toBe(true);

    refresh();
    webhooks.invalidateOnPromote?.(S);
    expect(stale()).toBe(true);

    refresh();
    webhooks.slots?.['workflows:triggerForm']?.[0]?.imported?.(S);
    expect(stale()).toBe(true);
  });
});

describe('webhook keys and writes', () => {
  it("marks every key of the space stale and leaves another space's", () => {
    for (const key of samples) queryClient.setQueryData(key, {});
    queryClient.setQueryData(webhookKeys.page('s2', {}), {});
    invalidateWebhooks(S);
    for (const key of samples) expect([key, invalidated(key)]).toEqual([key, true]);
    expect(invalidated(webhookKeys.page('s2', {}))).toBe(false);
  });

  it("drops the workflow editor's catalogue after a write, when that plugin is there", async () => {
    await actions.setEnabled(S, 'h1', false);
    const invalidateCatalog = vi.fn();
    exposePluginApi('workflows', { invalidateCatalog });
    await actions.setEnabled(S, 'h1', false);
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
    expect(invalidateCatalog).toHaveBeenCalledWith(S);
  });
});

describe('the webhook list', () => {
  const hook = {
    id: 'h1',
    name: 'Orders',
    direction: 'incoming',
    description: null,
    enabled: true,
    url: '',
    events: [],
    methods: ['POST'],
    auth: { mode: 'none' },
    endpoint: 'https://cms.test/plugins/webhooks/in/s1/orders',
    listeners: 0,
    source: 'admin',
    sourceRef: null,
    lastUsedAt: null,
  };

  async function list(permissions: string[]) {
    createTestSession({ spaces: { [S]: 'editor' }, permissions: { [S]: permissions } });
    webhooksApi.list.mockResolvedValue({ items: [hook], total: 1 });
    const wrapper = mount(WebhookList, {
      global: { stubs: { Icon: true, Switch: true, DeliveryList: true, WebhookDialog: true } },
    });
    await flushPromises();
    return wrapper;
  }

  it('shows the full incoming URL with a copy button, and where calls go', async () => {
    const wrapper = await list(['webhooks:read']);
    expect(wrapper.text()).toContain('https://cms.test/plugins/webhooks/in/s1/orders');
    expect(wrapper.find('[aria-label="Copy the URL of Orders"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('/plugins/webhooks/in/...');
  });

  it('says nothing runs the calls without the workflows plugin, and offers no connecting', async () => {
    const wrapper = await list(['webhooks:read', 'workflows:write']);
    expect(wrapper.text()).toContain('nothing runs them unless a plugin listens');
    expect(wrapper.text()).not.toContain('no workflow');
    expect(wrapper.text()).not.toContain('Connect to workflow');
  });

  it('offers connecting to a workflow to those who may write workflows', async () => {
    const CreateDialog = defineComponent({ setup: () => () => h('p') });
    exposePluginApi('workflows', { CreateDialog, invalidateCatalog: vi.fn() });
    const reader = await list(['webhooks:read']);
    expect(reader.text()).not.toContain('nothing runs them');
    expect(reader.text()).toContain('no workflow');
    expect(reader.text()).not.toContain('Connect to workflow');
    const writer = await list(['webhooks:read', 'workflows:write']);
    expect(writer.text()).toContain('Connect to workflow');
  });
});
