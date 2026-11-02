import type { FieldContext, FieldDefinition } from '@manablox/admin-sdk';
import { createTestSession, setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssetWands from '../../src/admin/slots/AssetWands.vue';
import DocumentGenerate from '../../src/admin/slots/DocumentGenerate.vue';
import FieldWand from '../../src/admin/slots/FieldWand.vue';
import TypeDesignAction from '../../src/admin/slots/TypeDesignAction.vue';

const aiApi = {
  available: vi.fn(async (): Promise<Record<string, string[]>> => ({})),
};

/** The viewer's permissions in space `s1`. */
function signIn(permissions: string[]) {
  createTestSession({ id: 'u1', role: 'editor', permissions: { s1: permissions } });
}

/** The capabilities the space's providers have. */
function providers(available: Record<string, string[]>) {
  aiApi.available.mockResolvedValue(available);
}

async function render(component: unknown, props: Record<string, unknown> = {}) {
  const wrapper = mount(component as never, {
    props: props as never,
    global: { stubs: { Icon: true } },
  });
  await flushPromises();
  return wrapper;
}

const field = { id: 'f1', name: 'title', label: 'Title', type: 'string', settings: {} };
const context = { spaceId: 's1', locale: 'en', readOnly: false } as unknown as FieldContext;
const fieldProps = (definition: object = field) => ({
  field: definition as FieldDefinition,
  value: '',
  update: () => {},
  context,
});

beforeEach(() => {
  setupAdminTest({ api: { plugins: { ai: aiApi } } });
  useTestSpace({ id: 's1' });
  aiApi.available.mockReset();
});

describe('the field wand', () => {
  it('shows with a text provider and `ai:use`', async () => {
    signIn(['ai:use']);
    providers({ text: ['openai'] });
    const wrapper = await render(FieldWand, fieldProps());
    expect(wrapper.find('button[aria-label="Write Title with AI"]').exists()).toBe(true);
  });

  it('hides without `ai:use`', async () => {
    signIn(['ai:read']);
    providers({ text: ['openai'] });
    const wrapper = await render(FieldWand, fieldProps());
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('hides without a provider that can do it', async () => {
    signIn(['ai:use']);
    providers({ text: ['openai'] });
    const wrapper = await render(FieldWand, fieldProps({ ...field, type: 'asset' }));
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('offers only the media the asset field accepts', async () => {
    signIn(['ai:use']);
    providers({ image: ['openai'], video: ['google'] });
    const wrapper = await render(
      FieldWand,
      fieldProps({ ...field, type: 'asset', settings: { accept: ['image/'] } }),
    );
    expect(wrapper.findAll('button').map((button) => button.attributes('aria-label'))).toEqual([
      'Generate an image',
    ]);
  });
});

describe('the asset library wands', () => {
  it('shows a button per capable provider', async () => {
    signIn(['ai:use']);
    providers({ image: ['openai'] });
    const wrapper = await render(AssetWands, { selection: [], added: () => {} });
    expect(wrapper.text()).toContain('Generate an image');
    expect(wrapper.text()).not.toContain('Generate a video');
  });

  it('hides without `ai:use`', async () => {
    signIn([]);
    providers({ image: ['openai'], video: ['google'] });
    const wrapper = await render(AssetWands, { selection: [], added: () => {} });
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

describe('the document editor action', () => {
  const type = { id: 't1', label: 'Article', fields: [{ name: 'body', type: 'richtext' }] };
  const document = { spaceId: 's1', typeId: 't1', locale: 'en', title: '', fields: {} };

  it('shows for writers with `ai:use` and a text provider', async () => {
    signIn(['ai:use', 'content:write']);
    providers({ text: ['openai'] });
    const wrapper = await render(DocumentGenerate, { document, type });
    expect(wrapper.text()).toContain('Generate');
  });

  it('hides for readers', async () => {
    signIn(['ai:use']);
    providers({ text: ['openai'] });
    const wrapper = await render(DocumentGenerate, { document, type });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('hides without a text provider', async () => {
    signIn(['ai:use', 'content:write']);
    providers({ image: ['openai'] });
    const wrapper = await render(DocumentGenerate, { document, type });
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

describe('the content type list action', () => {
  it('shows with a text provider and `ai:use`', async () => {
    signIn(['ai:use']);
    providers({ text: ['openai'] });
    const wrapper = await render(TypeDesignAction);
    expect(wrapper.text()).toContain('Describe a content model');
  });

  it('hides without `ai:use`', async () => {
    signIn([]);
    providers({ text: ['openai'] });
    const wrapper = await render(TypeDesignAction);
    expect(wrapper.text()).not.toContain('Describe a content model');
  });
});
