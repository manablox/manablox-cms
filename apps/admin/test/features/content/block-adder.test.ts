import {
  useBlockAdder,
  useBlockAddTakeover,
} from '@manablox/admin-sdk/features/content/useBlockAdder';
import { resetShortcuts, shortcutGroups } from '@manablox/admin-sdk/lib/shortcuts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

/** Alt+N as a browser sends it. */
function pressAltN() {
  const event = new KeyboardEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? window).dispatchEvent(event);
}

/** A blocks field element with an input, bound to the key inside a scope. */
function field(parent: HTMLElement = document.body, can = true) {
  const root = document.createElement('div');
  const input = document.createElement('input');
  root.append(input);
  parent.append(root);
  const add = vi.fn();
  const scope = effectScope();
  scope.run(() => useBlockAdder({ root: () => root, can: () => can, add }));
  return { root, input, add, leave: () => scope.stop() };
}

const scopes: (() => void)[] = [];
afterEach(() => {
  for (const leave of scopes.splice(0)) leave();
  resetShortcuts();
  document.body.innerHTML = '';
});

describe('which blocks field Alt+N adds to', () => {
  it('the one the cursor is in, the innermost when one holds another', () => {
    const outer = field();
    const inner = field(outer.root);
    const other = field();
    scopes.push(outer.leave, inner.leave, other.leave);

    inner.input.focus();
    pressAltN();
    expect([outer.add, inner.add, other.add].map((fn) => fn.mock.calls.length)).toEqual([0, 1, 0]);

    outer.input.focus();
    pressAltN();
    expect(outer.add).toHaveBeenCalledOnce();
  });

  it('the first on the page when the cursor is in none, skipping one that cannot add', () => {
    const empty = field(document.body, false);
    const first = field();
    const second = field();
    scopes.push(empty.leave, first.leave, second.leave);
    const title = document.createElement('input');
    document.body.prepend(title);
    title.focus();
    pressAltN();
    expect([empty.add, first.add, second.add].map((fn) => fn.mock.calls.length)).toEqual([0, 1, 0]);
  });

  it('a surface laid over the page, unless the cursor is in a field', () => {
    const page = field();
    scopes.push(page.leave);
    const add = vi.fn();
    const scope = effectScope();
    scope.run(() => useBlockAddTakeover({ can: () => true, add }));
    scopes.push(() => scope.stop());

    pressAltN();
    expect([page.add.mock.calls.length, add.mock.calls.length]).toEqual([0, 1]);
    page.input.focus();
    pressAltN();
    expect([page.add.mock.calls.length, add.mock.calls.length]).toEqual([1, 1]);
  });

  it('is listed once however many fields joined, and unbound when the last leaves', () => {
    const a = field();
    const b = field();
    const rows = () =>
      shortcutGroups.value
        .flatMap((group) => group.shortcuts)
        .filter((s) => s.label === 'Add a block');
    expect(rows()).toHaveLength(1);
    a.leave();
    expect(rows()).toHaveLength(1);
    b.leave();
    expect(rows()).toHaveLength(0);
  });
});
