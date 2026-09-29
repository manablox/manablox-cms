import { exposePluginApi, mockAdminApi, setupAdminTest } from '@manablox/admin-sdk/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import ConnectWorkflow from '../../src/admin/components/ConnectWorkflow.vue';
import webhooks from '../../src/admin/index';
import WebhookTriggerForm from '../../src/admin/slots/WebhookTriggerForm.vue';

mockAdminApi();

const hooks = [
  { id: 'h1', name: 'Orders', slug: 'orders' },
  { id: 'h2', name: 'Refunds', slug: 'refunds' },
];

const entry = () => {
  const found = webhooks.slots?.['workflows:triggerForm']?.[0];
  if (!found) throw new Error('no webhook trigger entry');
  return found;
};

describe('the webhook trigger kind', () => {
  it('contributes the `webhook` kind to the workflow editor', () => {
    expect(entry()).toMatchObject({ kind: 'webhook', icon: 'webhook', runLabel: 'Webhook call' });
  });

  it("points a new trigger at the preset endpoint, else at the space's first", () => {
    const { create, abort } = entry();
    expect(create('h2', hooks)).toEqual({ kind: 'webhook', webhookId: 'h2', filter: null });
    expect(create(null, hooks)).toEqual({ kind: 'webhook', webhookId: 'h1', filter: null });
    expect(create(null, undefined)).toEqual({ kind: 'webhook', webhookId: null, filter: null });
    expect(abort?.(null, hooks)).toEqual({ kind: 'webhook', webhookId: 'h1' });
  });

  it('is ready once it names an endpoint', () => {
    const { ready } = entry();
    expect(ready?.({ kind: 'webhook', webhookId: 'h1' })).toBe(true);
    expect(ready?.({ kind: 'webhook', webhookId: null })).toBe(false);
  });

  it('titles the trigger by its endpoint', () => {
    const { title } = entry();
    expect(title?.({ kind: 'webhook', webhookId: 'h2' }, hooks)).toBe('Refunds is called');
    expect(title?.({ kind: 'webhook', webhookId: 'gone' }, hooks)).toBe('A webhook is called');
    expect(title?.({ kind: 'webhook', webhookId: 'h1' }, undefined)).toBe('A webhook is called');
  });

  it('words the runs and aborts it started', () => {
    const { startedBy, startPart, abortedBy } = entry();
    expect(startedBy?.({ webhook: { name: 'Orders' } })).toBe('to Orders');
    expect(startedBy?.({})).toBeNull();
    expect(startPart?.({ webhook: {} })).toEqual({ label: 'Payload', path: 'payload' });
    expect(startPart?.({})).toBeNull();
    expect(abortedBy?.({ source: 'webhook', event: 'orders' } as never)).toBe(
      'by a call to orders',
    );
  });
});

describe('connecting an endpoint to a workflow', () => {
  const incoming = { id: 'h1', name: 'Orders' };

  beforeEach(() => setupAdminTest({ space: { id: 's1' } }));

  it('draws nothing without the workflows plugin', () => {
    const wrapper = mount(ConnectWorkflow, {
      props: { webhook: incoming },
      global: { stubs: { Icon: true } },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it("opens the workflows plugin's new workflow dialog on the endpoint", async () => {
    const CreateDialog = defineComponent({
      props: ['spaceId', 'kind', 'preset'],
      setup: (props) => () =>
        h('p', { 'data-dialog': '' }, `${props.spaceId}:${props.kind}:${props.preset}`),
    });
    exposePluginApi('workflows', { CreateDialog });
    const wrapper = mount(ConnectWorkflow, {
      props: { webhook: incoming },
      global: { stubs: { Icon: true } },
    });
    expect(wrapper.find('[data-dialog]').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-dialog]').text()).toBe('s1:webhook:h1');
  });
});

describe('the webhook trigger form', () => {
  const endpoints = [
    {
      id: 'h1',
      name: 'Orders',
      endpoint: 'https://cms.test/plugins/webhooks/in/s1/orders',
      enabled: true,
    },
    {
      id: 'h2',
      name: 'Refunds',
      endpoint: 'https://cms.test/plugins/webhooks/in/s1/refunds',
      enabled: false,
    },
  ];

  /** Stands in for the admin's select, showing its options and picking the last. */
  const Select = defineComponent({
    name: 'Select',
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        h(
          'button',
          {
            'data-select': '',
            onClick: () =>
              emit('update:modelValue', (props.options as { value: string }[]).at(-1)?.value),
          },
          (props.options as { label: string }[]).map((option) => option.label).join(','),
        ),
  });

  function form(mode: 'trigger' | 'abort' | 'create', webhookId: string | null) {
    const update = vi.fn();
    const wrapper = mount(WebhookTriggerForm, {
      props: {
        trigger: { kind: 'webhook', webhookId, filter: null },
        mode,
        spaceId: 's1',
        catalog: endpoints,
        readOnly: false,
        errorFor: () => null,
        update,
      },
      global: { stubs: { Select, Icon: true } },
    });
    return { wrapper, update };
  }

  beforeEach(() => setupAdminTest());

  it("lists the space's incoming endpoints and points the trigger at the one picked", async () => {
    const { wrapper, update } = form('trigger', 'h1');
    const select = wrapper.get('[data-select]');
    expect(select.text()).toBe('Orders,Refunds');
    await select.trigger('click');
    expect(update).toHaveBeenCalledWith({ kind: 'webhook', webhookId: 'h2', filter: null });
  });

  it("shows the picked endpoint's URL, and warns when it is switched off", () => {
    // The URL sits in a read-only field to copy from.
    const url = (mode: 'trigger' | 'create') =>
      form(mode, 'h1')
        .wrapper.findAll('input')
        .map((input) => (input.element as HTMLInputElement).value);
    expect(url('trigger')).toContain('https://cms.test/plugins/webhooks/in/s1/orders');
    expect(form('trigger', 'h2').wrapper.text()).toContain('This endpoint is switched off');
    expect(form('abort', 'h1').wrapper.text()).toContain('A call to this endpoint aborts runs');
    expect(url('create')).not.toContain('https://cms.test/plugins/webhooks/in/s1/orders');
  });
});
