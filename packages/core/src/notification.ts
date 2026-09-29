/** The notification catalogue: kinds, channels and defaults. Browser-safe. */

/** In-app is the admin inbox. */
export type NotificationChannel = 'inApp' | 'email' | 'push';
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['inApp', 'email', 'push'];

export const NOTIFICATION_CHANNEL_LABELS: Record<
  NotificationChannel,
  { label: string; description: string }
> = {
  inApp: { label: 'In the admin', description: 'The bell in the top bar and the inbox.' },
  email: { label: 'By email', description: 'To the address on your profile.' },
  push: { label: 'Push', description: 'To every browser you switched notifications on in.' },
};

export const NOTIFICATION_KINDS = [
  'content.approvalRequested',
  'content.approved',
  'content.rejected',
  'content.approvalWithdrawn',
  'member.granted',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Which channels a kind goes out on. */
export type NotificationPreference = Record<NotificationChannel, boolean>;

/** Per-kind overrides; missing entries use the default. */
export type NotificationPreferences = Partial<
  Record<NotificationKind, Partial<NotificationPreference>>
>;

export interface NotificationKindInfo {
  id: NotificationKind;
  label: string;
  description: string;
  /** Grouping in the preferences form. */
  group: 'content' | 'space';
  defaults: NotificationPreference;
}

export const NOTIFICATION_KIND_INFO: Record<NotificationKind, Omit<NotificationKindInfo, 'id'>> = {
  'content.approvalRequested': {
    label: 'A document awaits your approval',
    description: 'Someone who cannot publish a type you can created or submitted a document of it.',
    group: 'content',
    defaults: { inApp: true, email: true, push: true },
  },
  'content.approved': {
    label: 'Your document was approved',
    description: 'A reviewer approved and published a document you submitted.',
    group: 'content',
    defaults: { inApp: true, email: true, push: true },
  },
  'content.rejected': {
    label: 'Your document was sent back',
    description: 'A reviewer rejected a document you submitted, with a note on why.',
    group: 'content',
    defaults: { inApp: true, email: true, push: true },
  },
  'content.approvalWithdrawn': {
    label: 'A request for approval was withdrawn',
    description: 'The author took back a document that was waiting for your approval.',
    group: 'content',
    defaults: { inApp: true, email: false, push: false },
  },
  'member.granted': {
    label: 'You were added to a space, or your role changed',
    description: 'An administrator gave you a role in a space.',
    group: 'space',
    defaults: { inApp: true, email: true, push: false },
  },
};

export const NOTIFICATION_KIND_LIST: readonly NotificationKindInfo[] = NOTIFICATION_KINDS.map(
  (id) => ({ id, ...NOTIFICATION_KIND_INFO[id] }),
);

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** The catalogue's defaults with a person's overrides laid over. */
export function resolveNotificationPreferences(
  overrides: NotificationPreferences | null | undefined,
): Record<NotificationKind, NotificationPreference> {
  const out = {} as Record<NotificationKind, NotificationPreference>;
  for (const kind of NOTIFICATION_KINDS) {
    out[kind] = { ...NOTIFICATION_KIND_INFO[kind].defaults, ...(overrides?.[kind] ?? {}) };
  }
  return out;
}

/** Keeps only overrides, so later default changes still apply. */
export function compactNotificationPreferences(
  resolved: Partial<Record<NotificationKind, Partial<NotificationPreference>>>,
): NotificationPreferences {
  const out: NotificationPreferences = {};
  for (const kind of NOTIFICATION_KINDS) {
    const chosen = resolved[kind];
    if (!chosen) continue;
    const defaults = NOTIFICATION_KIND_INFO[kind].defaults;
    const diff: Partial<NotificationPreference> = {};
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = chosen[channel];
      if (value !== undefined && value !== defaults[channel]) diff[channel] = value;
    }
    if (Object.keys(diff).length) out[kind] = diff;
  }
  return out;
}

/** The state of one approval request. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Sent back',
  withdrawn: 'Withdrawn',
};

/** Live nudge to the recipient's tabs when a notification lands. */
export interface NotificationEvent {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string | null;
  spaceId: string | null;
  /** ISO timestamp. */
  at: string;
}
