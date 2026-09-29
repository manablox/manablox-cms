import type { ComponentLoader } from '@manablox/admin-plugin';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import { registerSlot, resetPluginRegistry } from '~/lib/plugins/registry';
import { meWithControls } from '../../controls-fixture';

const create = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));
vi.mock('~/features/spaces/queries', () => ({ spaces: { create } }));
vi.mock('@manablox/admin-sdk/lib/toast', async (original) => {
  const actual = await original<typeof import('@manablox/admin-sdk/lib/toast')>();
  return { toast: { ...actual.toast, info } };
});

import SpaceCreateForm from '~/features/spaces/components/SpaceCreateForm.vue';

type StepProps = { draft: Record<string, unknown>; setDraft: (patch: object) => void };

/** A create step that writes `patch` into its draft once mounted. */
const step =
  (patch: Record<string, unknown>): ComponentLoader =>
  async () => ({
    default: defineComponent({
      props: {
        draft: { type: Object, required: true },
        setDraft: { type: Function, required: true },
      },
      setup(props) {
        onMounted(() => (props as unknown as StepProps).setDraft(patch));
        return () => h('p', 'step');
      },
    }),
  });

function mountForm() {
  return mount(SpaceCreateForm, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}

type Exposed = { submit: () => Promise<boolean>; stages: string[]; stageLabel: string };

/** Ticks the radio card titled `title`. */
async function pick(wrapper: ReturnType<typeof mountForm>, title: string) {
  const label = wrapper.findAll('label').find((entry) => entry.text().startsWith(title));
  await label?.find('input').setValue(true);
}

async function submitAll(wrapper: ReturnType<typeof mountForm>) {
  const form = wrapper.vm as unknown as Exposed;
  // Each submit before the last stage moves on.
  for (let stage = 0; stage < 3 && create.mock.calls.length === 0; stage++) {
    await form.submit();
    await flushPromises();
  }
}

describe('space create steps', () => {
  beforeEach(() => {
    resetPluginRegistry();
    setActivePinia(createPinia());
    useSessionStore().me = {
      ...meWithControls(),
      role: 'superadmin',
      controls: {
        ...meWithControls().controls,
        features: { 'plugins.off': { presentation: 'hidden' } },
      },
    } as never;
    create.mockReset().mockResolvedValue({ id: 's2', warnings: [] });
    info.mockReset();
  });

  it("hands each shown step's draft to spaces.create under its plugin id", async () => {
    registerSlot({ id: 'hello', feature: 'plugins.hello' }, 'space.create.steps', {
      component: step({ greeting: 'Hi' }),
    });
    registerSlot({ id: 'off', feature: 'plugins.off' }, 'space.create.steps', {
      component: step({ never: true }),
    });
    const wrapper = mountForm();
    await flushPromises();
    await wrapper.find('#s-name').setValue('Blog');
    await submitAll(wrapper);

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: 'Blog',
      plugins: { hello: { greeting: 'Hi' } },
    });
    expect(create.mock.calls[0]?.[0].plugins).not.toHaveProperty('off');
  });

  it("adds a stage a step asks for, sends the step's data and shows the server's warnings", async () => {
    create.mockResolvedValue({ id: 's2', warnings: ['Check the site.'] });
    const stepProps = vi.fn();
    registerSlot({ id: 'site', feature: 'plugins.site' }, 'space.create.steps', {
      key: 'look',
      feature: null,
      stage: { label: 'Site look', title: 'Pick a look' },
      data: (draft) => (draft.look ? { style: draft.look } : undefined),
      component: async () => ({
        default: defineComponent({
          props: ['draft', 'setDraft', 'stage', 'setStage', 'address'],
          setup(props) {
            const step = props as unknown as {
              stage: string;
              setDraft: (patch: object) => void;
              setStage: (shown: boolean) => void;
              address: { value: string; default: string; set(value: string): void };
            };
            onMounted(() => {
              stepProps(step.stage, step.address.value, step.address.default);
              if (step.stage === 'space') {
                step.setStage(true);
                step.setDraft({ look: 'bold' });
                step.address.set('http://site.test');
              }
            });
            return () => h('p', `look ${step.stage}`);
          },
        }),
      }),
    });
    const wrapper = mountForm();
    await flushPromises();
    const form = wrapper.vm as unknown as Exposed;
    expect(form.stages).toEqual(['space', 'site.look']);
    await wrapper.find('#s-name').setValue('Site');
    await form.submit();
    await flushPromises();
    expect(form.stageLabel).toBe('Site look');
    expect(wrapper.text()).toContain('look own');
    await form.submit();
    await flushPromises();

    expect(stepProps).toHaveBeenCalledWith(
      'space',
      'http://localhost:3005',
      'http://localhost:3005',
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://site.test',
      plugins: { site: { style: 'bold' } },
    });
    expect(info).toHaveBeenCalledWith('Check the site.');
  });

  it('sends nothing for a step whose data is undefined', async () => {
    registerSlot({ id: 'site', feature: 'plugins.site' }, 'space.create.steps', {
      feature: null,
      data: () => undefined,
      component: step({ look: 'plain' }),
    });
    const wrapper = mountForm();
    await flushPromises();
    await wrapper.find('#s-name').setValue('Plain site');
    await submitAll(wrapper);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('plugins');
  });

  it('sends no plugins without a step', async () => {
    const wrapper = mountForm();
    await wrapper.find('#s-name').setValue('Plain');
    await submitAll(wrapper);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('plugins');
  });

  it('leaves out a starter whose `when` does not hold', async () => {
    const starter = (key: string, title: string, shown: boolean) =>
      registerSlot({ id: 'hello', feature: 'plugins.hello' }, 'space.create.starters', {
        key,
        feature: null,
        starter: { title, hint: 'A board.' },
        when: () => shown,
        component: step({}),
      });
    starter('shown', 'Shown board', true);
    starter('hidden', 'Hidden board', false);
    const wrapper = mountForm();
    await flushPromises();
    await wrapper.find('#s-name').setValue('Board');
    await pick(wrapper, 'Preconfigured');
    await (wrapper.vm as unknown as Exposed).submit();
    await flushPromises();
    expect(wrapper.text()).toContain('Shown board');
    expect(wrapper.text()).not.toContain('Hidden board');
  });

  it("creates a starter's planned types and sends its data with the space", async () => {
    const types = [{ name: 'greeting', kind: 'content', fields: [] }];
    registerSlot({ id: 'hello', feature: 'plugins.hello' }, 'space.create.starters', {
      key: 'greetings',
      feature: null,
      starter: { title: 'Greeting board', hint: 'A board of greetings.' },
      validate: (draft) => (draft.greeting ? null : 'Say hello first.'),
      plan: () => types as never,
      data: (draft) => ({ first: draft.greeting }),
      created: () => 'with a greeting',
      component: step({ greeting: 'Hi' }),
    });
    const wrapper = mountForm();
    await flushPromises();
    await wrapper.find('#s-name').setValue('Board');
    await pick(wrapper, 'Preconfigured');
    const form = wrapper.vm as unknown as Exposed;
    await form.submit();
    await flushPromises();
    await pick(wrapper, 'Greeting board');
    await flushPromises();
    await form.submit();
    await flushPromises();

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      starter: false,
      plan: { types },
      plugins: { hello: { first: 'Hi' } },
    });
  });
});
