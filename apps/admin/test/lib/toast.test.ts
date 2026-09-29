import { dismiss, holdToasts, releaseToasts, toast, toasts } from '@manablox/admin-sdk/lib/toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  releaseToasts();
  for (const item of toasts.value) dismiss(item.id);
  vi.useRealTimers();
});

describe('toasts', () => {
  it('close on their own, an error later than a success', () => {
    toast.success('Saved');
    toast.error('Not saved');
    vi.advanceTimersByTime(4000);
    expect(toasts.value.map((t) => t.message)).toEqual(['Not saved']);
    vi.advanceTimersByTime(4000);
    expect(toasts.value).toEqual([]);
  });

  it('keep their clock while the stack is held, and finish it after', () => {
    toast.error('Not saved');
    vi.advanceTimersByTime(6000);
    holdToasts();
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);
    releaseToasts();
    vi.advanceTimersByTime(1999);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toEqual([]);
  });

  it('start held when one arrives while the stack is held', () => {
    holdToasts();
    toast.success('Saved');
    vi.advanceTimersByTime(10_000);
    expect(toasts.value).toHaveLength(1);
    releaseToasts();
    vi.advanceTimersByTime(4000);
    expect(toasts.value).toEqual([]);
  });

  it('show the same message once, with a fresh clock', () => {
    toast.success('Saved');
    vi.advanceTimersByTime(3000);
    toast.success('Saved');
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(toasts.value).toHaveLength(1);
  });
});
