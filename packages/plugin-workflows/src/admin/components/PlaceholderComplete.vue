<script lang="ts">
/** Events an inner wrapper already handled, shared so an outer one leaves them alone. */
const handled = new WeakSet<Event>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  completePlaceholder,
  matchHints,
  type PlaceholderHint,
  type PlaceholderQuery,
  placeholderQuery,
} from '../model';

/**
 * Suggests placeholders while one is typed in any text input or textarea inside it: after
 * `{{`, the matching hints appear at the caret, and Enter, Tab or a click completes one.
 * The innermost of nested wrappers handles an input.
 */
const props = defineProps<{ hints: readonly PlaceholderHint[] }>();

type Field = HTMLInputElement | HTMLTextAreaElement;

const field = ref<Field | null>(null);
const typed = ref<PlaceholderQuery | null>(null);
const active = ref(0);
const at = ref({ left: 0, top: 0 });
const listId = `placeholder-list-${Math.random().toString(36).slice(2)}`;

const matches = computed(() => (typed.value ? matchHints(props.hints, typed.value.query) : []));
const open = computed(() => field.value !== null && matches.value.length > 0);

const isField = (target: EventTarget | null): target is Field =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && ['text', 'search', 'url', ''].includes(target.type));

function close() {
  field.value = null;
  typed.value = null;
}

// The field owns the list for assistive tech while it shows.
watch([field, open, active], ([target, shown, index], [previous]) => {
  if (previous && previous !== target) {
    for (const name of ['aria-controls', 'aria-activedescendant', 'aria-expanded']) {
      previous.removeAttribute(name);
    }
  }
  if (!target) return;
  target.setAttribute('aria-autocomplete', 'list');
  target.setAttribute('aria-expanded', String(shown));
  if (shown) {
    target.setAttribute('aria-controls', listId);
    target.setAttribute('aria-activedescendant', `${listId}-${index}`);
  } else target.removeAttribute('aria-activedescendant');
});

const list = ref<HTMLElement | null>(null);

// Placed at the caret: the field scrolling moves it along, the list scrolls itself, anything
// else scrolling closes it.
function onScroll(event: Event) {
  if (list.value && event.target instanceof Node && list.value.contains(event.target)) return;
  if (field.value && event.target === field.value) update(field.value);
  else close();
}

// Keeps the highlighted option in view while the arrow keys walk the list. Only the list
// scrolls: `scrollIntoView` could scroll the page too, and that closes the list.
watch(active, async (index) => {
  await nextTick();
  const box = list.value;
  const option = box?.children[index];
  if (!box || !(option instanceof HTMLElement)) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
});
watch(open, (shown) => {
  if (shown) window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  else window.removeEventListener('scroll', onScroll, { capture: true });
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, { capture: true }));

/** Re-reads the placeholder at the caret of `target`. */
function update(target: Field) {
  const caret = target.selectionStart ?? target.value.length;
  const query = target.readOnly ? null : placeholderQuery(target.value, caret);
  if (!query) return close();
  if (typed.value?.query !== query.query) active.value = 0;
  field.value = target;
  typed.value = query;
  at.value = caretPoint(target, caret);
}

function onInput(event: Event) {
  if (handled.has(event) || !isField(event.target)) return;
  handled.add(event);
  update(event.target);
}

function onKeydown(event: KeyboardEvent) {
  if (handled.has(event) || !open.value || event.target !== field.value) return;
  handled.add(event);
  const count = matches.value.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    const hint = matches.value[active.value];
    if (hint) choose(hint);
  } else if (event.key === 'Escape') {
    close();
  } else return;
  event.preventDefault();
  event.stopPropagation();
}

/** The caret moved without typing: follow it, or close when it left the placeholder. */
function onKeyup(event: KeyboardEvent) {
  if (handled.has(event) || !isField(event.target)) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  handled.add(event);
  if (field.value === event.target) update(event.target);
}

/** Writes the completion through an `input` event, so the owning form sees it as typing. */
async function choose(hint: PlaceholderHint) {
  const target = field.value;
  const query = typed.value;
  if (!target || !query) return;
  const caret = target.selectionStart ?? target.value.length;
  const done = completePlaceholder(target.value, caret, query.start, hint.path);
  close();
  target.value = done.text;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  target.focus();
  target.setSelectionRange(...done.selection);
}

/** The caret's viewport position, measured on an invisible copy of the field. */
function caretPoint(target: Field, caret: number): { left: number; top: number } {
  const style = getComputedStyle(target);
  const mirror = document.createElement('div');
  for (const name of [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'tabSize',
  ] as const) {
    mirror.style[name] = style[name];
  }
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    visibility: 'hidden',
    overflow: 'hidden',
    whiteSpace: target instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre',
    overflowWrap: 'break-word',
  });
  mirror.textContent = target.value.slice(0, caret);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
  const x = marker.offsetLeft - target.scrollLeft;
  const y = marker.offsetTop - target.scrollTop + line;
  mirror.remove();
  const box = target.getBoundingClientRect();
  return {
    left: Math.min(box.left + Math.min(x, box.width - 8), window.innerWidth - 336),
    top: Math.min(box.top + y + 4, box.bottom + 4),
  };
}
</script>

<template>
  <div
    @input="onInput"
    @keydown="onKeydown"
    @keyup="onKeyup"
    @click="isField($event.target) && field === $event.target && update($event.target)"
    @focusout="close"
  >
    <slot />
    <Teleport to="body">
      <ul
        v-if="open"
        :id="listId"
        ref="list"
        role="listbox"
        aria-label="Placeholders"
        class="mb-popover wf:fixed wf:max-h-64 wf:w-80 wf:overscroll-contain"
        :style="{ left: `${at.left}px`, top: `${at.top}px` }"
      >
        <li
          v-for="(hint, index) in matches"
          :id="`${listId}-${index}`"
          :key="hint.path"
          role="option"
          :aria-selected="index === active"
          :data-highlighted="index === active ? '' : undefined"
          class="mb-menu-item wf:flex wf:cursor-pointer wf:items-baseline wf:gap-2 wf:px-2"
          @mousedown.prevent="choose(hint)"
          @mouseenter="active = index"
        >
          <span class="wf:shrink-0 wf:font-mono wf:text-xs">{{ hint.path }}</span>
          <span class="wf:min-w-0 wf:flex-1 wf:truncate wf:text-2xs wf:text-surface-500">{{ hint.hint }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>
