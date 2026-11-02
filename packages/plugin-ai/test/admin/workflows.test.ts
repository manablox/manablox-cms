import { queryClient } from '@manablox/admin-sdk';
import { setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import ai from '../../src/admin/index';
import WorkflowModelField from '../../src/admin/slots/WorkflowModelField.vue';

const aiApi = {
  catalog: vi.fn(async () => ({
    providers: [
      {
        kind: 'openai',
        defaultModels: { text: 'gpt-small' },
        models: {
          text: [
            { id: 'gpt-small', label: 'Small' },
            { id: 'gpt-large', label: 'Large' },
          ],
          image: [{ id: 'img-1', label: 'Pictures' }],
        },
      },
    ],
  })),
  providers: vi.fn(async () => [
    { ref: 'openai', kind: 'openai', models: {} },
    { ref: 'local', kind: 'custom', models: {} },
  ]),
  available: vi.fn(async () => ({ text: ['openai'], image: ['openai'] })),
};

/** Stands in for the admin's select, showing the options it gets. */
const Select = defineComponent({
  name: 'Select',
  props: ['modelValue', 'options', 'disabled'],
  setup: (props) => () =>
    h(
      'ul',
      (props.options as { value: string; label: string }[]).map((option) =>
        h('li', { 'data-value': option.value }, option.label),
      ),
    ),
});

async function field(kind: string, config: Record<string, unknown>, value: unknown = '') {
  const wrapper = mount(WorkflowModelField, {
    props: {
      spec: {
        name: kind === 'aiModel' ? 'model' : 'provider',
        label: kind,
        kind,
        options: [{ value: 'openai', label: 'OpenAI' }],
      },
      value,
      config,
      readOnly: false,
      id: 'f1',
      update: () => {},
    } as never,
    global: { stubs: { Select }, plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
}

const labels = (wrapper: Awaited<ReturnType<typeof field>>) =>
  wrapper.findAll('li').map((item) => item.text());

beforeEach(() => {
  setupAdminTest({ api: { plugins: { ai: aiApi } } });
  useTestSpace({ id: 's1' });
});

describe('the AI step in the workflow editor', () => {
  it('draws the provider and model fields whether or not AI is on in the space', () => {
    const controls = ai.slots?.['workflows:fieldControl'] ?? [];
    expect(controls.map((entry) => [entry.kind, entry.feature])).toEqual([
      ['aiProvider', null],
      ['aiModel', null],
    ]);
    const describe = ai.slots?.['workflows:createActions']?.[0];
    expect(describe).toMatchObject({
      label: 'Describe it',
      permission: 'ai:use',
      feature: 'plugins.ai.designModels',
    });
  });

  it("lists the server's providers in the provider field", async () => {
    const wrapper = await field('aiProvider', {});
    expect(labels(wrapper)).toEqual(['OpenAI']);
    expect(aiApi.providers).not.toHaveBeenCalled();
  });

  it("offers the provider's models for the node's job, after the provider's own", async () => {
    const text = await field('aiModel', { provider: 'openai' });
    expect(labels(text)).toEqual(["The provider's model (gpt-small)", 'Small', 'Large']);

    const image = await field('aiModel', { provider: 'openai', capability: 'image' });
    expect(labels(image)).toEqual(["The provider's model", 'Pictures']);
  });

  it('falls back to the first provider available for the job', async () => {
    const wrapper = await field('aiModel', {});
    expect(labels(wrapper)).toContain('Large');
  });

  it('keeps an unlisted current model visible', async () => {
    const wrapper = await field('aiModel', { provider: 'openai' }, 'gpt-old');
    expect(labels(wrapper).at(-1)).toBe('gpt-old');
  });

  it('asks for a self-hosted model by name', async () => {
    const wrapper = await field('aiModel', { provider: 'local' }, 'llama');
    expect(wrapper.find('li').exists()).toBe(false);
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('llama');
  });
});
