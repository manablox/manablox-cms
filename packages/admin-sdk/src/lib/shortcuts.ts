import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue';

/**
 * Keyboard layer: one registry, one listener, and a help dialog that reads the registry.
 * Registrations live as long as their component.
 */

/** A key notation: chords joined by `+`, sequences separated by a space (`g c`). */
export interface Shortcut {
  /** `mod+s`, `mod+shift+z`, `?`, `Escape`, `g c`. `mod` is Cmd on a Mac, Ctrl elsewhere. */
  keys: string;
  /** Help dialog label, imperative: "Save". */
  label: string;
  /** Help dialog section; defaults to the registration's group. */
  group?: string;
  /** Fire while a text field has focus. */
  whileTyping?: boolean;
  /** Fire while a modal is open. */
  inModal?: boolean;
  /** Bound but not listed in the help dialog. */
  hidden?: boolean;
  /** While false the key does nothing and the row is dimmed. */
  enabled?: MaybeRefOrGetter<boolean>;
  run: (event: KeyboardEvent) => void;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: (Shortcut & { available: boolean })[];
}

interface Registration {
  id: number;
  group: string;
  /** Lower sorts first in the help dialog. */
  order: number;
  shortcuts: MaybeRefOrGetter<Shortcut[]>;
}

interface Chord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Whether Shift must match, or is just how the character is typed. */
  shiftMatters: boolean;
}

/** How long a sequence prefix like `g` stays armed. */
const SEQUENCE_MS = 1400;

export const isMac =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent);

const registrations = ref<Registration[]>([]);
/** Open modal count; while nonzero only `inModal` shortcuts run. */
const modals = ref(0);
let nextId = 1;
let listening = false;
let pending: { chord: Chord; timer: ReturnType<typeof setTimeout> } | null = null;

// --- notation ---------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  space: ' ',
  plus: '+',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

function parseChord(text: string): Chord {
  // Split on `+` but keep a literal `+` as a key: `mod++` is Ctrl and the plus key.
  const parts = text.split('+').map((part) => part.trim().toLowerCase());
  const chord: Chord = { key: '', mod: false, shift: false, alt: false, shiftMatters: false };
  for (const [index, part] of parts.entries()) {
    if (part === '' && index < parts.length - 1) continue;
    if (part === 'mod' || part === 'ctrl' || part === 'cmd' || part === 'meta') chord.mod = true;
    else if (part === 'shift') chord.shift = true;
    else if (part === 'alt' || part === 'option') chord.alt = true;
    else chord.key = ALIASES[part] ?? part;
  }
  if (chord.key === '' && text.endsWith('+')) chord.key = '+';
  // Shift on punctuation depends on the layout, so only letters, digits and named keys check it.
  chord.shiftMatters = chord.shift || chord.key.length > 1 || /^[a-z0-9]$/.test(chord.key);
  return chord;
}

function parseKeys(keys: string): Chord[] {
  return keys.split(/\s+/).filter(Boolean).map(parseChord);
}

function matches(chord: Chord, event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  // The non-`mod` modifier must be clear, or Ctrl+Cmd+S on a Mac would save.
  if (mod !== chord.mod || (isMac ? event.ctrlKey : event.metaKey)) return false;
  if (event.altKey !== chord.alt) return false;
  if (chord.shiftMatters && event.shiftKey !== chord.shift) return false;
  if (event.key.toLowerCase() === chord.key) return true;
  // Mac Option composes characters, so match the physical key for Alt+letter/digit.
  if (chord.alt && /^[a-z0-9]$/.test(chord.key)) {
    const code = /\d/.test(chord.key) ? `Digit${chord.key}` : `Key${chord.key.toUpperCase()}`;
    return event.code === code;
  }
  return false;
}

function sameChord(a: Chord, b: Chord): boolean {
  return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}

/** Display tokens, one array per chord: `g c` is `[['G'], ['C']]`. */
export function formatKeys(keys: string): string[][] {
  return parseKeys(keys).map((chord) => {
    const tokens: string[] = [];
    if (chord.mod) tokens.push(isMac ? '⌘' : 'Ctrl');
    if (chord.shift) tokens.push(isMac ? '⇧' : 'Shift');
    if (chord.alt) tokens.push(isMac ? '⌥' : 'Alt');
    tokens.push(formatKey(chord.key));
    return tokens;
  });
}

const WORDS: Record<string, string> = { '⌘': 'Cmd', '⇧': 'Shift', '⌥': 'Option' };

/** Keys as plain text for titles and hints (`Cmd+S` / `Ctrl+S`, `G then C`); with `label`, `Label (N)`. */
export function shortcutHint(keys: string, label?: string): string {
  const text = formatKeys(keys)
    .map((chord) => chord.map((token) => WORDS[token] ?? token).join('+'))
    .join(' then ');
  return label ? `${label} (${text})` : text;
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
};

function formatKey(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

// --- picking from a list by digit --------------------------------------------------

/** The digit that picks the item at `index`: 1 to 9, then 0 for the tenth. */
export function digitFor(index: number): string | null {
  if (index < 9) return String(index + 1);
  return index === 9 ? '0' : null;
}

/** Inverse of `digitFor`; null for anything but a bare digit. */
export function indexForDigit(event: KeyboardEvent): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey || !/^\d$/.test(event.key)) return null;
  return event.key === '0' ? 9 : Number(event.key) - 1;
}

// --- registry ---------------------------------------------------------------------

export function registerShortcuts(registration: Omit<Registration, 'id'>): () => void {
  const id = nextId++;
  registrations.value = [...registrations.value, { ...registration, id }];
  start();
  return () => {
    registrations.value = registrations.value.filter((entry) => entry.id !== id);
  };
}

/** Hands the keyboard to a modal; returns the release. */
export function suspendShortcuts(): () => void {
  modals.value += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    modals.value = Math.max(0, modals.value - 1);
  };
}

/** Everything currently bound, in the order the help dialog shows it. */
export const shortcutGroups = computed<ShortcutGroup[]>(() => {
  const groups = new Map<
    string,
    { order: number; seq: number; shortcuts: ShortcutGroup['shortcuts'] }
  >();
  for (const [seq, registration] of registrations.value.entries()) {
    for (const shortcut of toValue(registration.shortcuts)) {
      if (shortcut.hidden) continue;
      const name = shortcut.group ?? registration.group;
      let bucket = groups.get(name);
      if (!bucket) {
        bucket = { order: registration.order, seq, shortcuts: [] };
        groups.set(name, bucket);
      }
      bucket.shortcuts.push({ ...shortcut, available: toValue(shortcut.enabled ?? true) });
    }
  }
  return [...groups]
    .sort(([, a], [, b]) => a.order - b.order || a.seq - b.seq)
    .map(([name, bucket]) => ({ name, shortcuts: bucket.shortcuts }));
});

// --- dispatch ---------------------------------------------------------------------

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

/** Every bound shortcut, deepest registration first: a page overrides the shell. */
function candidates(event: KeyboardEvent): { shortcut: Shortcut; chords: Chord[] }[] {
  const typing = isTyping(event);
  const suspended = modals.value > 0;
  const out: { shortcut: Shortcut; chords: Chord[] }[] = [];
  for (let index = registrations.value.length - 1; index >= 0; index--) {
    const registration = registrations.value[index];
    if (!registration) continue;
    for (const shortcut of toValue(registration.shortcuts)) {
      if (suspended && !shortcut.inModal) continue;
      if (typing && !shortcut.whileTyping) continue;
      if (!toValue(shortcut.enabled ?? true)) continue;
      out.push({ shortcut, chords: parseKeys(shortcut.keys) });
    }
  }
  return out;
}

function clearPending(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

function fire(shortcut: Shortcut, event: KeyboardEvent): void {
  event.preventDefault();
  shortcut.run(event);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.repeat) return;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;

  const options = candidates(event);

  if (pending) {
    const prefix = pending.chord;
    clearPending();
    const found = options.find(
      ({ chords }) =>
        chords.length === 2 &&
        chords[0] &&
        chords[1] &&
        sameChord(chords[0], prefix) &&
        matches(chords[1], event),
    );
    if (found) {
      fire(found.shortcut, event);
      return;
    }
    // Not the second key of anything: fall through, so `g` then `?` still opens help.
  }

  const direct = options.find(
    ({ chords }) => chords.length === 1 && chords[0] && matches(chords[0], event),
  );
  if (direct) {
    fire(direct.shortcut, event);
    return;
  }

  const prefix = options.find(
    ({ chords }) => chords.length > 1 && chords[0] && matches(chords[0], event),
  );
  if (prefix?.chords[0]) {
    event.preventDefault();
    pending = { chord: prefix.chords[0], timer: setTimeout(clearPending, SEQUENCE_MS) };
  }
}

function start(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKeydown);
}

/** Test seam: drops every registration and the armed prefix. */
export function resetShortcuts(): void {
  registrations.value = [];
  modals.value = 0;
  clearPending();
}

// --- the help dialog ---------------------------------------------------------------

/** Whether the shortcut overview is open. */
export const helpOpen = ref(false);

export function toggleShortcutsHelp(): void {
  helpOpen.value = !helpOpen.value;
}
