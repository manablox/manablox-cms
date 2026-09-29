/** `@manablox/core/testing`: fixed ids for tests. */

/** A valid v4-shaped UUID that is the same on every run; `n` tells them apart. */
export const fixedId = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

/** Fixed ids for records a test only needs to name. */
export const ids = {
  space: fixedId(1),
  otherSpace: fixedId(2),
  user: fixedId(3),
  otherUser: fixedId(4),
  type: fixedId(5),
  otherType: fixedId(6),
  role: fixedId(7),
  doc: fixedId(8),
  otherDoc: fixedId(9),
  asset: fixedId(10),
  otherAsset: fixedId(11),
  tag: fixedId(12),
  author: fixedId(13),
  workflow: fixedId(14),
  webhook: fixedId(15),
  menu: fixedId(16),
  localization: fixedId(17),
  entry: fixedId(18),
  notification: fixedId(19),
  template: fixedId(20),
  /** Matches no record. */
  missing: fixedId(99),
} as const;
