import { pending, settle } from '@manablox/admin-sdk/lib/confirm';
import { lockedNotice } from '@manablox/admin-sdk/lib/features';
import { dismiss, toasts } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';

afterEach(() => {
  for (const item of toasts.value) dismiss(item.id);
});

const messages = () => toasts.value.map((t) => `${t.kind}:${t.message}`);

describe('runWrite', () => {
  it('toasts the success sentence, or one built from the result', async () => {
    expect(await runWrite(async () => 'x', { success: 'Saved' })).toBe(true);
    expect(await runWrite(async () => ({ name: 'A' }), { success: (r) => `Saved ${r.name}` })).toBe(
      true,
    );
    expect(messages()).toEqual(['success:Saved', 'success:Saved A']);
  });

  it('toasts a failure, fills the error ref and resolves false', async () => {
    const error = ref<string | null>('stale');
    const ok = await runWrite(
      async () => {
        throw new Error('boom');
      },
      { success: 'Saved', error },
    );
    expect(ok).toBe(false);
    expect(error.value).toBeTruthy();
    expect(messages()).toEqual([`error:${error.value}`]);
  });

  it('clears the error ref when a write starts', async () => {
    const error = ref<string | null>('old');
    await runWrite(async () => undefined, { error });
    expect(error.value).toBeNull();
  });

  it('holds busy for the write and skips while already busy', async () => {
    const busy = ref(false);
    let seen: boolean | null = null;
    await runWrite(
      async () => {
        seen = busy.value;
      },
      { busy },
    );
    expect(seen).toBe(true);
    expect(busy.value).toBe(false);

    busy.value = true;
    let ran = false;
    expect(
      await runWrite(async () => {
        ran = true;
      }),
    ).toBe(true);
    expect(
      await runWrite(
        async () => {
          ran = false;
        },
        { busy },
      ),
    ).toBe(false);
    expect(ran).toBe(true);
  });

  it('uses the given sentence for a failure', async () => {
    const error = ref<string | null>(null);
    await runWrite(
      async () => {
        throw new Error('quota');
      },
      { error, describe: (e) => (e instanceof Error ? e.message : 'unknown') },
    );
    expect(error.value).toBe('quota');
  });
});

describe('confirmAndRun', () => {
  it('runs nothing when dismissed', async () => {
    let ran = false;
    const asked = confirmAndRun({ title: 'Delete?', message: 'Gone.' }, async () => {
      ran = true;
    });
    expect(pending.value?.title).toBe('Delete?');
    settle(false);
    expect(await asked).toBe(false);
    expect(ran).toBe(false);
    expect(toasts.value).toEqual([]);
  });

  it('runs and toasts after confirming', async () => {
    const asked = confirmAndRun(
      { title: 'Delete?', message: 'Gone.', danger: true },
      async () => undefined,
      { success: 'Deleted' },
    );
    expect(pending.value?.danger).toBe(true);
    settle(true);
    expect(await asked).toBe(true);
    expect(messages()).toEqual(['success:Deleted']);
  });
});

describe('control refusals', () => {
  const refusal = (key: string, params: Record<string, unknown>) =>
    Object.assign(new Error(key), { data: { key, details: [{ key, params }] } });

  it('opens the locked notice for a switched-off feature instead of a toast', async () => {
    setActivePinia(createPinia());
    const ok = await runWrite(async () => {
      throw refusal('control.feature', {
        feature: 'databags',
        message: 'Upgrade for databags',
        link: null,
      });
    });
    expect(ok).toBe(false);
    expect(lockedNotice.value).toEqual({
      feature: 'databags',
      message: 'Upgrade for databags',
      link: null,
    });
    expect(toasts.value).toEqual([]);
    lockedNotice.value = null;
  });

  it('toasts a limit with its sentence, or the message the control API set', async () => {
    setActivePinia(createPinia());
    await runWrite(async () => {
      throw refusal('control.limit', { limit: 'documents', max: 50 });
    });
    await runWrite(async () => {
      throw refusal('control.readOnly', { message: 'Paused until the invoice is paid.' });
    });
    expect(messages()).toEqual([
      'error:The limit of 50 documents on this instance is reached - remove some before adding more.',
      'error:Paused until the invoice is paid.',
    ]);
    expect(lockedNotice.value).toBeNull();
  });
});
