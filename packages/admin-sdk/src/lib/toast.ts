import { ref } from 'vue';

/** Toasts rendered by `Toaster.vue`. Timers pause while the stack is hovered or focused. */
export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  /** In ms, excluding time held. */
  duration: number;
}

export const toasts = ref<Toast[]>([]);

const DURATION: Record<Toast['kind'], number> = { success: 4000, info: 5000, error: 8000 };
let nextId = 1;

/** Per-toast timer state. */
const clocks = new Map<
  number,
  { timer: ReturnType<typeof setTimeout> | null; startedAt: number; remaining: number }
>();
let held = false;

function start(id: number): void {
  const clock = clocks.get(id);
  if (!clock || clock.timer) return;
  clock.startedAt = Date.now();
  clock.timer = setTimeout(() => dismiss(id), clock.remaining);
}

function push(kind: Toast['kind'], message: string): void {
  const id = nextId++;
  const duration = DURATION[kind];
  // Replace an identical message instead of stacking it.
  for (const toast of toasts.value) if (toast.message === message) dismiss(toast.id);
  toasts.value = [...toasts.value, { id, kind, message, duration }];
  clocks.set(id, { timer: null, startedAt: Date.now(), remaining: duration });
  if (!held) start(id);
}

export function dismiss(id: number): void {
  const clock = clocks.get(id);
  if (clock?.timer) clearTimeout(clock.timer);
  clocks.delete(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Pauses every timer. */
export function holdToasts(): void {
  if (held) return;
  held = true;
  const now = Date.now();
  for (const clock of clocks.values()) {
    if (!clock.timer) continue;
    clearTimeout(clock.timer);
    clock.timer = null;
    clock.remaining = Math.max(0, clock.remaining - (now - clock.startedAt));
  }
}

/** Resumes timers paused by `holdToasts`. */
export function releaseToasts(): void {
  if (!held) return;
  held = false;
  for (const id of clocks.keys()) start(id);
}

export const toast = {
  success: (message: string) => push('success', message),
  info: (message: string) => push('info', message),
  error: (message: string) => push('error', message),
};
