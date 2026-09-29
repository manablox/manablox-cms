import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const leaveGuards: (() => Promise<boolean> | boolean)[] = [];
const confirm = vi.fn(async (_options: { message: string }) => true);

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => leaveGuards.push(guard),
}));
vi.mock('@manablox/admin-sdk/lib/confirm', () => ({
  confirm: (options: { message: string }) => confirm(options),
}));

import { useUnsavedGuard } from '@manablox/admin-sdk/composables/useUnsavedGuard';

enableAutoUnmount(afterEach);

beforeEach(() => {
  leaveGuards.length = 0;
  confirm.mockClear();
});

const host = (dirty: () => boolean, what?: () => string) =>
  mount(
    defineComponent({
      setup() {
        useUnsavedGuard(dirty, what);
        return () => null;
      },
    }),
  );

describe('useUnsavedGuard', () => {
  it('lets a clean form leave without asking', async () => {
    host(() => false);
    expect(await leaveGuards[0]?.()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reads the label when leaving, so it follows the page it guards', async () => {
    const label = ref('This content type');
    host(
      () => true,
      () => label.value,
    );
    label.value = 'This databag type';
    await leaveGuards[0]?.();
    expect(confirm.mock.calls[0]?.[0].message).toMatch(/^This databag type has unsaved changes/);
  });

  it('asks the browser to confirm an unload only while dirty', () => {
    const dirty = ref(true);
    host(() => dirty.value);
    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    dirty.value = false;
    const allowed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });
});
