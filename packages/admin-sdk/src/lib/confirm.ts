import { ref, shallowRef } from 'vue';

export interface ConfirmChoice {
  value: string;
  label: string;
  description?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  /** Text that must be typed before confirm unlocks. */
  requireText?: string;
  /** Radio options shown with the confirm; the first is preselected. */
  choices?: ConfirmChoice[];
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/** The single app-wide confirm, rendered by `<ConfirmDialog />` at the root. */
export const pending = shallowRef<PendingConfirm | null>(null);
export const typed = ref('');
/** The selected radio when `choices` is set. */
export const chosen = ref('');

function open(options: ConfirmOptions, resolve: (confirmed: boolean) => void): void {
  // Cancel any open confirm so its promise still settles.
  pending.value?.resolve(false);
  typed.value = '';
  chosen.value = options.choices?.[0]?.value ?? '';
  pending.value = { ...options, resolve };
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => open(options, resolve));
}

/** Resolves to the chosen value, or `null` if dismissed. */
export function confirmChoice<T extends string>(
  options: ConfirmOptions & { choices: ConfirmChoice[] },
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    open(options, (confirmed) => resolve(confirmed ? (chosen.value as T) : null));
  });
}

export function settle(confirmed: boolean): void {
  const current = pending.value;
  pending.value = null;
  typed.value = '';
  // The resolver reads `chosen`, so clear it after.
  current?.resolve(confirmed);
  chosen.value = '';
}
