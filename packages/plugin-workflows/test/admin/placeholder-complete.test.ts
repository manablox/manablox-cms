import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import PlaceholderComplete from '../../src/admin/components/PlaceholderComplete.vue';
import {
  completePlaceholder,
  matchHints,
  type PlaceholderHint,
  placeholderQuery,
} from '../../src/admin/model';

const HINTS: PlaceholderHint[] = [
  { path: 'content.title', hint: 'The title' },
  { path: 'content.fields.<name>', hint: 'A field' },
  { path: 'nodes.fetch.body', hint: 'What it answered', from: 'fetch' },
  { path: 'actor.email', hint: '' },
];

describe('placeholderQuery', () => {
  it('finds an unclosed {{ before the caret and the path typed so far', () => {
    expect(placeholderQuery('Hi {{ con', 9)).toEqual({ start: 3, query: 'con' });
    expect(placeholderQuery('{{', 2)).toEqual({ start: 0, query: '' });
    expect(placeholderQuery('{{content.ti', 12)).toEqual({ start: 0, query: 'content.ti' });
  });

  it('stays quiet outside a placeholder', () => {
    expect(placeholderQuery('Hi {{ content.title }} there', 28)).toBeNull();
    expect(placeholderQuery('{{ a b', 6)).toBeNull();
    expect(placeholderQuery('plain text', 10)).toBeNull();
    // The caret back before the braces.
    expect(placeholderQuery('Hi {{ con', 2)).toBeNull();
  });
});

describe('matchHints', () => {
  it('ranks paths that start with the query before those that contain it', () => {
    expect(matchHints(HINTS, 'con').map((hint) => hint.path)).toEqual([
      'content.title',
      'content.fields.<name>',
    ]);
    expect(matchHints(HINTS, 'body').map((hint) => hint.path)).toEqual(['nodes.fetch.body']);
    expect(matchHints(HINTS, 'CONTENT.T').map((hint) => hint.path)).toEqual(['content.title']);
    expect(matchHints(HINTS, '')).toHaveLength(4);
    expect(matchHints(HINTS, '', 2)).toHaveLength(2);
  });
});

describe('completePlaceholder', () => {
  it('closes the placeholder and puts the caret after it', () => {
    expect(completePlaceholder('Hi {{ con!', 9, 3, 'content.title')).toEqual({
      text: 'Hi {{ content.title }}!',
      selection: [22, 22],
    });
  });

  it('reuses braces that already close it', () => {
    expect(completePlaceholder('{{ co }} x', 5, 0, 'content.title').text).toBe(
      '{{ content.title }} x',
    );
  });

  it('selects a <name> part to type over', () => {
    const done = completePlaceholder('{{ content.f', 12, 0, 'content.fields.<name>');
    expect(done.text).toBe('{{ content.fields.<name> }}');
    expect(done.text.slice(...done.selection)).toBe('<name>');
  });
});

describe('PlaceholderComplete', () => {
  /** A controlled input inside the wrapper, as the forms have them. */
  const Host = defineComponent({
    setup() {
      const value = ref('');
      return () =>
        h(PlaceholderComplete, { hints: HINTS }, () =>
          h('input', {
            value: value.value,
            onInput: (event: Event) => {
              value.value = (event.target as HTMLInputElement).value;
            },
          }),
        );
    },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function typeInto(input: HTMLInputElement, text: string) {
    // Vue skips an event stamped in the millisecond its listener was attached, which a fast
    // mount-then-type can hit; the input's own handler stamps it first.
    vi.advanceTimersByTime(1);
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }

  const options = () => [...document.body.querySelectorAll('[role="option"]')];
  const key = (input: HTMLInputElement, name: string) =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );

  it('suggests after {{ and completes the highlighted one with Enter', async () => {
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.find('input').element as HTMLInputElement;

    await typeInto(input, 'Hi {{ con');
    expect(options().map((option) => option.textContent)).toEqual([
      'content.titleThe title',
      'content.fields.<name>A field',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);

    key(input, 'ArrowDown');
    await nextTick();
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    key(input, 'ArrowUp');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    await nextTick();
    await nextTick();

    expect(enter.defaultPrevented).toBe(true);
    expect(input.value).toBe('Hi {{ content.title }}');
    expect(options()).toHaveLength(0);
    wrapper.unmount();
  });

  it('closes on Escape and leaves Enter alone when nothing is offered', async () => {
    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.find('input').element as HTMLInputElement;

    await typeInto(input, '{{ act');
    expect(options()).toHaveLength(1);
    key(input, 'Escape');
    await nextTick();
    expect(options()).toHaveLength(0);

    await typeInto(input, '{{ nothing.like.this');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('scrolls the highlighted option into view and stays open while the list scrolls', async () => {
    const many: PlaceholderHint[] = Array.from({ length: 30 }, (_, i) => ({
      path: `nodes.step_${i}`,
      hint: '',
    }));
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(PlaceholderComplete, { hints: many }, () => h('input')),
      }),
      { attachTo: document.body },
    );
    const input = wrapper.find('input').element as HTMLInputElement;
    await typeInto(input, '{{ nodes');
    expect(options()).toHaveLength(30);

    // No layout here: 30px rows in a list that shows four of them.
    const list = document.body.querySelector('[role="listbox"]') as HTMLElement;
    Object.defineProperty(list, 'clientHeight', { value: 120 });
    for (const [i, option] of options().entries()) {
      Object.defineProperty(option, 'offsetTop', { value: i * 30 });
      Object.defineProperty(option, 'offsetHeight', { value: 30 });
    }
    for (let i = 0; i < 12; i++) key(input, 'ArrowDown');
    await nextTick();
    await nextTick();
    expect(list.scrollTop).toBe(12 * 30 + 30 - 120);
    key(input, 'ArrowUp');
    for (let i = 0; i < 10; i++) key(input, 'ArrowUp');
    await nextTick();
    await nextTick();
    expect(list.scrollTop).toBe(30);

    list.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(options()).toHaveLength(30);

    window.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(options()).toHaveLength(0);
    wrapper.unmount();
  });

  it('lets the innermost of nested wrappers answer', async () => {
    const inner: PlaceholderHint[] = [{ path: 'item.title', hint: 'Inner only' }];
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(PlaceholderComplete, { hints: HINTS }, () =>
            h(PlaceholderComplete, { hints: inner }, () => h('input')),
          ),
      }),
      { attachTo: document.body },
    );
    await typeInto(wrapper.find('input').element as HTMLInputElement, '{{ ');
    expect(options().map((option) => option.textContent)).toEqual(['item.titleInner only']);
    wrapper.unmount();
  });
});
