<script setup lang="ts">
import type { ThemeDesign } from '@manablox/site';
import {
  type BoxKind,
  type BoxScope,
  type BoxSide,
  boxPatch,
  boxSide,
  type StyleEditor,
  scopeLabel,
  scopeShortLabel,
  scopeSides,
} from '../../model/style-visual';
import SpaceChip from './SpaceChip.vue';

/**
 * Padding and margin as nested boxes around the element, like a browser's box model:
 * each side shows its step; clicking one picks a new step for that side, both opposite
 * sides or all four.
 */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  readOnly: boolean;
}>();

const SIDES: readonly BoxSide[] = ['top', 'right', 'bottom', 'left'];
const EXTRA: Record<BoxKind, readonly string[]> = { padding: ['0'], margin: ['0', 'auto'] };

const own = (kind: BoxKind, side: BoxSide) => boxSide(props.editor.value, kind, side);
const inherited = (kind: BoxKind, side: BoxSide) =>
  boxSide(props.editor.inherited, kind, side).value;

/** Opens where the side's value comes from; an empty box starts with all sides. */
function startScope(kind: BoxKind, side: BoxSide): BoxScope {
  const scope = own(kind, side).scope;
  if (scope) return scope;
  return SIDES.some((entry) => own(kind, entry).scope) ? 'side' : 'all';
}

const scopes = (side: BoxSide) =>
  (['side', 'axis', 'all'] as const).map((value) => ({
    value,
    label: scopeShortLabel(side, value),
    title: scopeLabel(side, value),
    sides: scopeSides(side, value),
  }));

function pick(kind: BoxKind, side: BoxSide, value: string | undefined, scope: string | undefined) {
  props.editor.patch(boxPatch(kind, side, (scope as BoxScope | undefined) ?? 'side', value));
}
</script>

<template>
  <div class="ws:select-none ws:text-center" role="group" aria-label="Padding and margin">
    <!-- Margin: outside the element. -->
    <div class="ws:relative ws:rounded-card ws:border ws:border-dashed ws:border-warn-300 ws:bg-warn-50 ws:px-2 ws:pt-5 ws:pb-1 ws:dark:border-warn-800 ws:dark:bg-warn-900/20">
      <span class="ws:absolute ws:top-1 ws:left-2 ws:text-2xs ws:font-semibold ws:tracking-wide ws:text-warn-700 ws:uppercase ws:dark:text-warn-300">Margin</span>
        <div class="ws:-mt-3 ws:mb-1 ws:flex ws:justify-center">
          <SpaceChip
            :model-value="own('margin', 'top').value"
            :inherited="inherited('margin', 'top')"
            :theme="theme"
            label="Margin top"
            :extra="EXTRA.margin"
            :scopes="scopes('top')"
            :scope="startScope('margin', 'top')"
            :disabled="readOnly"
            @pick="(value, scope) => pick('margin', 'top', value, scope)"
          />
        </div>
        <div class="ws:flex ws:items-center ws:gap-1">
          <SpaceChip
            :model-value="own('margin', 'left').value"
            :inherited="inherited('margin', 'left')"
            :theme="theme"
            label="Margin left"
            :extra="EXTRA.margin"
            :scopes="scopes('left')"
            :scope="startScope('margin', 'left')"
            :disabled="readOnly"
            @pick="(value, scope) => pick('margin', 'left', value, scope)"
          />

          <!-- Padding: inside the element's edge. -->
          <div class="ws:relative ws:min-w-0 ws:flex-1 ws:rounded-control ws:border ws:border-ok-500/40 ws:bg-ok-500/5 ws:px-2 ws:pt-5 ws:pb-1 ws:dark:border-ok-700 ws:dark:bg-ok-700/20">
            <span class="ws:absolute ws:top-1 ws:left-2 ws:text-2xs ws:font-semibold ws:tracking-wide ws:text-ok-700 ws:uppercase ws:dark:text-ok-500">Padding</span>
            <div class="ws:-mt-3 ws:mb-1 ws:flex ws:justify-center">
              <SpaceChip
                :model-value="own('padding', 'top').value"
                :inherited="inherited('padding', 'top')"
                :theme="theme"
                label="Padding top"
                :extra="EXTRA.padding"
                :scopes="scopes('top')"
                :scope="startScope('padding', 'top')"
                :disabled="readOnly"
                @pick="(value, scope) => pick('padding', 'top', value, scope)"
              />
            </div>
            <div class="ws:flex ws:items-center ws:gap-1">
              <SpaceChip
                :model-value="own('padding', 'left').value"
                :inherited="inherited('padding', 'left')"
                :theme="theme"
                label="Padding left"
                :extra="EXTRA.padding"
                :scopes="scopes('left')"
                :scope="startScope('padding', 'left')"
                :disabled="readOnly"
                @pick="(value, scope) => pick('padding', 'left', value, scope)"
              />
              <div class="ws:flex ws:h-9 ws:min-w-0 ws:flex-1 ws:items-center ws:justify-center ws:rounded-sm ws:border ws:border-surface-300 ws:bg-surface-0 ws:text-2xs ws:text-surface-500 ws:dark:border-surface-600 ws:dark:bg-surface-900">
                element
              </div>
              <SpaceChip
                :model-value="own('padding', 'right').value"
                :inherited="inherited('padding', 'right')"
                :theme="theme"
                label="Padding right"
                :extra="EXTRA.padding"
                :scopes="scopes('right')"
                :scope="startScope('padding', 'right')"
                :disabled="readOnly"
                @pick="(value, scope) => pick('padding', 'right', value, scope)"
              />
            </div>
            <div class="ws:mt-1 ws:flex ws:justify-center">
              <SpaceChip
                :model-value="own('padding', 'bottom').value"
                :inherited="inherited('padding', 'bottom')"
                :theme="theme"
                label="Padding bottom"
                :extra="EXTRA.padding"
                :scopes="scopes('bottom')"
                :scope="startScope('padding', 'bottom')"
                :disabled="readOnly"
                @pick="(value, scope) => pick('padding', 'bottom', value, scope)"
              />
            </div>
          </div>

          <SpaceChip
            :model-value="own('margin', 'right').value"
            :inherited="inherited('margin', 'right')"
            :theme="theme"
            label="Margin right"
            :extra="EXTRA.margin"
            :scopes="scopes('right')"
            :scope="startScope('margin', 'right')"
            :disabled="readOnly"
            @pick="(value, scope) => pick('margin', 'right', value, scope)"
          />
        </div>
        <div class="ws:mt-1 ws:flex ws:justify-center">
          <SpaceChip
            :model-value="own('margin', 'bottom').value"
            :inherited="inherited('margin', 'bottom')"
            :theme="theme"
            label="Margin bottom"
            :extra="EXTRA.margin"
            :scopes="scopes('bottom')"
            :scope="startScope('margin', 'bottom')"
            :disabled="readOnly"
            @pick="(value, scope) => pick('margin', 'bottom', value, scope)"
          />
        </div>
    </div>
  </div>
</template>
