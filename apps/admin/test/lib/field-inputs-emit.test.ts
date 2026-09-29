import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Component, defineComponent, h } from 'vue';

/*
 * The draft store tracks two levels (`useDraftForm({ shallow: 2 })`), so a field input must
 * emit a new value, never change `modelValue` in place. Every registered input is mounted
 * with a deeply frozen value and driven through its buttons and inputs: an in-place write
 * throws, and the thrown error fails the test.
 */

// Every fetch answers with the same rows, readable as a list or a page, so relation fields show chips.
vi.mock('@manablox/admin-sdk/lib/api', () => {
  const row = (id: string) => ({
    id,
    localizationId: `l-${id}`,
    title: id,
    name: id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    size: 1,
    width: 1,
    height: 1,
    alt: null,
    thumbnailUrl: null,
    url: `/${id}`,
    permalink: `/${id}`,
    typeId: 't1',
    status: 'draft',
    meta: {},
    tags: [],
    spaceIds: ['s1'],
    email: `${id}@example.com`,
    role: 'editor',
  });
  const rows = ['a1', 'a2', 'c1', 'c2', 'u1', 'tpl1'].map(row);
  const answer = () =>
    Promise.resolve(Object.assign([...rows], { items: rows, total: rows.length }));
  const group = new Proxy({}, { get: () => answer });
  return { api: new Proxy({}, { get: () => group }) };
});
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({
    currentId: 's1',
    locale: 'en',
    spaces: [{ id: 's1', name: 'Space' }],
    contentTypes: [],
    dataKinds: [],
    typeById: () => null,
    fieldTypeMeta: () => null,
  }),
}));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({ can: () => true, isSuperadmin: true, me: null }),
}));

import { provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { inputComponent, registeredInputKeys } from '~/lib/field-components';

const blockType = {
  id: 't1',
  name: 'section',
  label: 'Section',
  kind: 'block',
  fields: [
    {
      id: 'bf1',
      name: 'heading',
      label: 'Heading',
      type: 'string',
      settings: {},
      required: false,
      localized: false,
      unique: false,
      admin: { zone: 'main', width: 100, position: 0 },
    },
  ],
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * A value and settings per input; a new input without an entry fails the coverage test.
 * `typed` marks inputs the test cannot drive (a rich text editor), so no emit is expected.
 */
const FIXTURES: Record<
  string,
  { value: unknown; settings?: Record<string, unknown>; typed?: boolean }
> = {
  string: { value: 'hello' },
  richtext: {
    value: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    },
    typed: true,
  },
  number: { value: 3 },
  boolean: { value: true },
  date: { value: '2026-01-01' },
  select: {
    value: ['a'],
    settings: {
      multiple: true,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
  },
  link: {
    value: {
      mode: 'external',
      contentId: null,
      url: 'https://example.com',
      target: '_self',
      label: 'Go',
    },
  },
  asset: { value: ['a1', 'a2'], settings: { multiple: true } },
  content: { value: ['c1', 'c2'], settings: { multiple: true } },
  user: { value: 'u1' },
  block: {
    value: { blockId: 'b1', type: 't1', fields: { heading: 'x' } },
    settings: { types: ['t1'] },
  },
  blocks: {
    value: {
      blocks: [
        { blockId: 'b1', type: 't1', fields: { heading: 'x' } },
        { blockId: 'b2', type: 't1', fields: { heading: 'y' } },
      ],
    },
    settings: { types: ['t1'] },
  },
  repeater: {
    value: [
      { itemId: 'i1', fields: { label: 'x' } },
      { itemId: 'i2', fields: { label: 'y' } },
    ],
    settings: { fields: [{ name: 'label', type: 'string' }], min: 1 },
  },
  template: { value: 'tpl1' },
  databag: { value: 'type1' },
};

const IN_PLACE =
  /read.only|not extensible|Cannot (?:assign|add|delete|define)|object is not extensible/i;

async function drive(component: Component, key: string) {
  const loader = (component as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader;
  if (loader) await loader();
  const fixture = FIXTURES[key] ?? { value: null };
  const value = deepFreeze(structuredClone(fixture.value));
  const errors: unknown[] = [];
  const emitted: unknown[] = [];
  const Host = defineComponent({
    setup() {
      provideFieldContext({
        spaceId: 's1',
        locale: 'en',
        errorFor: () => null,
        errorUnder: () => false,
        readOnly: false,
        typeById: (id) => (id === 't1' ? (blockType as never) : null),
        typeByName: () => null,
        blockTypes: () => [blockType as never],
        fieldTypeMeta: () => null,
      });
      return () =>
        h(component, {
          id: `field-${key}`,
          field: {
            id: key,
            name: key,
            label: key,
            type: key,
            settings: fixture.settings ?? {},
            required: false,
            localized: false,
            unique: false,
            admin: { zone: 'main', width: 100, position: 0 },
          },
          settings: fixture.settings ?? {},
          modelValue: value,
          path: [key],
          'onUpdate:modelValue': (next: unknown) => emitted.push(next),
        });
    },
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: { Teleport: true },
      config: {
        errorHandler: (error) => {
          errors.push(error);
        },
        warnHandler: () => {},
      },
    },
  });
  await flushPromises();

  for (const button of wrapper.findAll('button')) {
    if (!button.exists() || button.attributes('disabled') !== undefined) continue;
    await button.trigger('click').catch((error: unknown) => errors.push(error));
  }
  for (const input of wrapper.findAll('input, textarea')) {
    if (!input.exists()) continue;
    const type = input.attributes('type');
    if (type === 'checkbox' || type === 'radio') await input.trigger('change');
    else if (type === 'number') await input.setValue('7');
    else if (type === 'date' || type === 'datetime-local') await input.setValue('2026-02-02');
    else await input.setValue('changed');
  }
  await flushPromises();
  wrapper.unmount();
  return { errors, emitted, value };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('field inputs emit new values', () => {
  it('has a fixture for every registered input', () => {
    expect(registeredInputKeys().filter((key) => !(key in FIXTURES))).toEqual([]);
  });

  it.each(Object.keys(FIXTURES))(
    '%s never writes into its model value',
    async (key) => {
      const component = inputComponent(key);
      expect(component).not.toBeNull();
      const { errors, emitted, value } = await drive(component as Component, key);
      const inPlace = errors.filter((error) => IN_PLACE.test(String(error)));
      expect(inPlace).toEqual([]);
      // Driving it changed something, and every change was a new value.
      if (typeof value === 'object' && value !== null && !FIXTURES[key]?.typed) {
        expect(emitted.length).toBeGreaterThan(0);
        for (const next of emitted) expect(next).not.toBe(value);
      }
    },
    20_000,
  );

  it('catches an input that writes in place', async () => {
    const Mutating = defineComponent({
      props: ['modelValue', 'settings', 'field', 'path', 'id'],
      setup(props) {
        return () =>
          h(
            'button',
            {
              onClick: () => {
                (props.modelValue as { blocks: unknown[] }).blocks.push({});
              },
            },
            'Add',
          );
      },
    });
    const { errors } = await drive(Mutating, 'blocks');
    expect(errors.some((error) => IN_PLACE.test(String(error)))).toBe(true);
  });
});
