import { firstField, focusFirstField, focusFirstFieldSoon } from '@manablox/admin-sdk/lib/focus';
import { afterEach, describe, expect, it } from 'vitest';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the field a form opens on', () => {
  it('skips buttons, checkboxes and radios for the first thing that takes a value', () => {
    const root = mount(`
      <button>Close</button>
      <input type="checkbox" />
      <input type="radio" />
      <input type="hidden" />
      <input id="name" />
      <textarea></textarea>
    `);
    expect(firstField(root)?.id).toBe('name');
  });

  it('counts a textarea, a select and a combobox button as fields', () => {
    expect(firstField(mount('<button>x</button><textarea id="a"></textarea>'))?.id).toBe('a');
    expect(firstField(mount('<select id="b"></select><input />'))?.id).toBe('b');
    expect(firstField(mount('<button role="combobox" id="c"></button><input />'))?.id).toBe('c');
  });

  it('passes over a disabled, read-only or hidden field', () => {
    const root = mount(`
      <input disabled />
      <input readonly />
      <div hidden><input /></div>
      <div aria-hidden="true"><input /></div>
      <input id="open" />
    `);
    expect(firstField(root)?.id).toBe('open');
  });

  it('lets `autofocus` win over document order', () => {
    const root = mount('<input id="first" /><textarea id="marked" autofocus></textarea>');
    expect(firstField(root)?.id).toBe('marked');
  });

  it('focuses it, and reports a form with nothing to fill in', () => {
    const root = mount('<input id="name" />');
    expect(focusFirstField(root)).toBe(true);
    expect(document.activeElement?.id).toBe('name');
    expect(focusFirstField(mount('<button>OK</button>'))).toBe(false);
  });
});

describe('a field that is still on its way', () => {
  /** Lets the MutationObserver deliver what was just appended. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('is focused when it arrives', async () => {
    const root = mount('<p>Loading...</p>');
    expect(focusFirstFieldSoon(root)).toBe(false);
    const input = document.createElement('input');
    root.append(input);
    await settle();
    expect(document.activeElement).toBe(input);
  });

  it('is left alone once a key has been pressed in the meantime', async () => {
    const root = mount('<p>Loading...</p>');
    focusFirstFieldSoon(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.append(document.createElement('input'));
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});
