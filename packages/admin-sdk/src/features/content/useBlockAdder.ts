import { onScopeDispose, shallowRef } from 'vue';
import { registerShortcuts } from '../../lib/shortcuts';

/**
 * A single Alt+N "add a block" key shared by all blocks fields. It targets the innermost
 * focused field, else a takeover (the visual editor), else the first field on the page.
 */
export interface BlockAdder {
  /** The field's element; focus inside it makes it the target. */
  root: () => HTMLElement | null;
  /** False when the field has no allowed types. */
  can: () => boolean;
  add: () => void;
}

export interface BlockAddTakeover {
  can: () => boolean;
  add: () => void;
}

const adders = shallowRef<BlockAdder[]>([]);
const takeovers = shallowRef<BlockAddTakeover[]>([]);
let members = 0;
let release: (() => void) | null = null;

function live(): { adder: BlockAdder; root: HTMLElement }[] {
  const out: { adder: BlockAdder; root: HTMLElement }[] = [];
  for (const adder of adders.value) {
    const root = adder.root();
    if (root?.isConnected && adder.can()) out.push({ adder, root });
  }
  return out;
}

/** The innermost blocks field containing focus. */
function focused(entries: ReturnType<typeof live>): BlockAdder | undefined {
  const active = document.activeElement;
  if (!active) return undefined;
  const around = entries.filter(({ root }) => root.contains(active));
  return around.find(
    ({ root }) => !around.some((other) => other.root !== root && root.contains(other.root)),
  )?.adder;
}

function target(): (() => void) | undefined {
  const entries = live();
  const inner = focused(entries);
  if (inner) return inner.add;
  const takeover = takeovers.value.at(-1);
  if (takeover) return takeover.can() ? takeover.add : undefined;
  // The first field in document order.
  const first = entries.sort((a, b) =>
    a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )[0];
  return first?.adder.add;
}

function join(): () => void {
  members += 1;
  release ??= registerShortcuts({
    group: 'Blocks',
    order: 25,
    shortcuts: [
      {
        keys: 'alt+n',
        label: 'Add a block',
        whileTyping: true,
        enabled: () => target() !== undefined,
        run: () => target()?.(),
      },
    ],
  });
  let left = false;
  return () => {
    if (left) return;
    left = true;
    members -= 1;
    if (members === 0) {
      release?.();
      release = null;
    }
  };
}

/** Joins a blocks field to the key while the component is mounted. */
export function useBlockAdder(adder: BlockAdder): void {
  adders.value = [...adders.value, adder];
  const leave = join();
  onScopeDispose(() => {
    adders.value = adders.value.filter((entry) => entry !== adder);
    leave();
  });
}

/** Takes the key over from unfocused fields while mounted. */
export function useBlockAddTakeover(takeover: BlockAddTakeover): void {
  takeovers.value = [...takeovers.value, takeover];
  const leave = join();
  onScopeDispose(() => {
    takeovers.value = takeovers.value.filter((entry) => entry !== takeover);
    leave();
  });
}
