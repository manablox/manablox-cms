import {
  ACTION_ICON_NAMES,
  EAGER_ICON_NAMES,
  ICON_NAMES,
  SUBJECT_ICON_NAMES,
  TYPE_ICON_NAMES,
} from '@manablox/admin-sdk/lib/icon-names';
import ACTION_ICONS from '@manablox/admin-sdk/lib/icons/actions';
import { EAGER_ICONS } from '@manablox/admin-sdk/lib/icons/eager';
import SUBJECT_ICONS from '@manablox/admin-sdk/lib/icons/subjects';
import { describe, expect, it } from 'vitest';

const sorted = (names: readonly string[]) => [...names].sort();

describe('icon packs', () => {
  it('hold exactly the names listed for them', () => {
    expect(sorted(Object.keys(EAGER_ICONS))).toEqual(sorted(EAGER_ICON_NAMES));
    expect(sorted(Object.keys(ACTION_ICONS))).toEqual(sorted(ACTION_ICON_NAMES));
    expect(sorted(Object.keys(SUBJECT_ICONS))).toEqual(sorted(SUBJECT_ICON_NAMES));
  });

  it('never share a name', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('cover every content-type picker icon', () => {
    const known = new Set(ICON_NAMES);
    expect(TYPE_ICON_NAMES.filter((name) => !known.has(name))).toEqual([]);
  });

  it('carry icon data', () => {
    for (const pack of [EAGER_ICONS, ACTION_ICONS, SUBJECT_ICONS])
      for (const data of Object.values(pack)) expect(data.body.length).toBeGreaterThan(0);
  });
});
