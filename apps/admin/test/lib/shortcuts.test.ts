import {
  formatKeys,
  registerShortcuts,
  resetShortcuts,
  shortcutGroups,
  suspendShortcuts,
} from '@manablox/admin-sdk/lib/shortcuts';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Not a Mac here, so `mod` is Ctrl. Keys are dispatched on `window`. */
function press(key: string, modifiers: Partial<KeyboardEventInit> = {}, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  (target ?? window).dispatchEvent(event);
  return event;
}

function bind(shortcuts: Parameters<typeof registerShortcuts>[0]['shortcuts'], group = 'Test') {
  return registerShortcuts({ shortcuts, group, order: 0 });
}

afterEach(() => {
  vi.useRealTimers();
  resetShortcuts();
  document.body.innerHTML = '';
});

describe('key notation', () => {
  it('fires a chord and swallows the browser default', () => {
    const run = vi.fn();
    bind([{ keys: 'mod+s', label: 'Save', whileTyping: true, run }]);
    const event = press('s', { ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('tells mod+z from mod+shift+z', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    bind([
      { keys: 'mod+z', label: 'Undo', whileTyping: true, run: undo },
      { keys: 'mod+shift+z', label: 'Redo', whileTyping: true, run: redo },
    ]);
    press('z', { ctrlKey: true });
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([1, 0]);
    press('Z', { ctrlKey: true, shiftKey: true });
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([1, 1]);
  });

  it('ignores whether Shift was needed to type a punctuation key', () => {
    const run = vi.fn();
    bind([{ keys: '?', label: 'Help', run }]);
    press('?', { shiftKey: true });
    press('?');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not treat the modifier that is not `mod` as `mod`', () => {
    const run = vi.fn();
    bind([{ keys: 'mod+s', label: 'Save', whileTyping: true, run }]);
    press('s', { metaKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('reads an Alt chord from the physical key when Option composed a character', () => {
    const add = vi.fn();
    const first = vi.fn();
    bind([
      { keys: 'alt+n', label: 'Add a field', whileTyping: true, run: add },
      { keys: 'alt+1', label: 'First', whileTyping: true, run: first },
    ]);
    // Option+N on a Mac is a dead key, Option+1 types `¡`.
    press('Dead', { altKey: true, code: 'KeyN' });
    press('¡', { altKey: true, code: 'Digit1' });
    expect([add.mock.calls.length, first.mock.calls.length]).toEqual([1, 1]);
    // Without Alt, `code` alone is not a match.
    press('Dead', { code: 'KeyN' });
    expect(add).toHaveBeenCalledOnce();
  });

  it('does not fire on an auto-repeat', () => {
    const run = vi.fn();
    bind([{ keys: 'n', label: 'New', run }]);
    press('n', { repeat: true });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('sequences', () => {
  it('waits for the second key', () => {
    const content = vi.fn();
    const assets = vi.fn();
    bind([
      { keys: 'g c', label: 'Go to content', run: content },
      { keys: 'g a', label: 'Go to assets', run: assets },
    ]);
    press('g');
    expect(content).not.toHaveBeenCalled();
    press('c');
    expect(content).toHaveBeenCalledOnce();
    press('g');
    press('a');
    expect(assets).toHaveBeenCalledOnce();
  });

  it('falls back to a single-key shortcut when the second key ends nothing', () => {
    const go = vi.fn();
    const help = vi.fn();
    bind([
      { keys: 'g c', label: 'Go to content', run: go },
      { keys: '?', label: 'Help', run: help },
    ]);
    press('g');
    press('?');
    expect(go).not.toHaveBeenCalled();
    expect(help).toHaveBeenCalledOnce();
  });

  it('forgets the prefix after a pause', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    bind([{ keys: 'g c', label: 'Go to content', run }]);
    press('g');
    vi.advanceTimersByTime(2000);
    press('c');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('when the keys stand down', () => {
  it('leaves a text field alone unless the shortcut says otherwise', () => {
    const bare = vi.fn();
    const withModifier = vi.fn();
    bind([
      { keys: 'n', label: 'New', run: bare },
      { keys: 'mod+s', label: 'Save', whileTyping: true, run: withModifier },
    ]);
    const input = document.createElement('input');
    document.body.append(input);
    press('n', {}, input);
    press('s', { ctrlKey: true }, input);
    expect(bare).not.toHaveBeenCalled();
    expect(withModifier).toHaveBeenCalledOnce();
  });

  it('hands the keyboard to a modal', () => {
    const page = vi.fn();
    const modal = vi.fn();
    bind([
      { keys: 'n', label: 'New', run: page },
      { keys: 'Escape', label: 'Close', inModal: true, run: modal },
    ]);
    const resume = suspendShortcuts();
    press('n');
    press('Escape');
    expect(page).not.toHaveBeenCalled();
    expect(modal).toHaveBeenCalledOnce();
    resume();
    press('n');
    expect(page).toHaveBeenCalledOnce();
  });

  it('skips a shortcut that is not enabled', () => {
    const run = vi.fn();
    bind([{ keys: 'n', label: 'New', enabled: () => false, run }]);
    press('n');
    expect(run).not.toHaveBeenCalled();
  });

  it('gives the key to the registration made last', () => {
    const shell = vi.fn();
    const page = vi.fn();
    bind([{ keys: 'n', label: 'Shell', run: shell }]);
    bind([{ keys: 'n', label: 'Page', run: page }]);
    press('n');
    expect(shell).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledOnce();
  });

  it('unbinds when the registration is released', () => {
    const run = vi.fn();
    bind([{ keys: 'n', label: 'New', run }])();
    press('n');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('what the help dialog reads', () => {
  it('groups by name, orders the groups, and marks the disabled ones', () => {
    registerShortcuts({
      group: 'Everywhere',
      order: 100,
      shortcuts: [{ keys: '?', label: 'Keyboard shortcuts', run: () => {} }],
    });
    registerShortcuts({
      group: 'This page',
      order: 0,
      shortcuts: [
        { keys: 'n', label: 'New menu', run: () => {} },
        { keys: 'Escape', label: 'Clear the selection', enabled: () => false, run: () => {} },
        { keys: 'x', label: 'An alias', hidden: true, run: () => {} },
      ],
    });
    expect(shortcutGroups.value.map((group) => group.name)).toEqual(['This page', 'Everywhere']);
    const page = shortcutGroups.value[0];
    expect(page?.shortcuts.map((shortcut) => shortcut.label)).toEqual([
      'New menu',
      'Clear the selection',
    ]);
    expect(page?.shortcuts.map((shortcut) => shortcut.available)).toEqual([true, false]);
  });

  it('prints the notation as caps, one array per chord', () => {
    expect(formatKeys('mod+shift+z')).toEqual([['Ctrl', 'Shift', 'Z']]);
    expect(formatKeys('g c')).toEqual([['G'], ['C']]);
    expect(formatKeys('Escape')).toEqual([['Esc']]);
  });
});
