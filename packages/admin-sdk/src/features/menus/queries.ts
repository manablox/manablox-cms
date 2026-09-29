import { type MaybeRefOrGetter, toValue } from 'vue';
import { api } from '../../lib/api';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import { required, type SpaceRef, useSpaceQuery } from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

export type { MenuDetail } from '../../lib/api-types';

/** A space's menus. */
export function useMenus(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.menus.list, (id) => api.menus.list({ spaceId: id }), { spaceId });
}

/** One menu with entries resolved for the admin's locale. */
export function useMenu(
  id: MaybeRefOrGetter<string>,
  locale: MaybeRefOrGetter<string>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.menus.detail(space, toValue(id), toValue(locale)),
    (space) => api.menus.get({ spaceId: space, id: toValue(id), locale: toValue(locale) }),
    { spaceId, enabled: () => Boolean(toValue(id)) },
  );
}

/** Menus that link a document. */
export function useMenusFor(localizationId: MaybeRefOrGetter<string | null>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.menus.usedIn(space, toValue(localizationId)),
    (space) =>
      api.menus.usedIn({ spaceId: space, localizationId: required(toValue(localizationId)) }),
    { spaceId, enabled: () => Boolean(toValue(localizationId)) },
  );
}

/** Every menu with the spot a document holds in it, for the "In menus" picker. */
export function useMenuPlacements(
  localizationId: MaybeRefOrGetter<string | null>,
  locale: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.menus.placements(space, toValue(localizationId), toValue(locale)),
    (space) =>
      api.menus.placements({
        spaceId: space,
        localizationId: required(toValue(localizationId)),
        locale: toValue(locale),
      }),
    { spaceId, enabled: () => Boolean(toValue(localizationId)) && toValue(enabled) },
  );
}

type MenuInput = Parameters<typeof api.menus.create>[0];
type PlacementsInput = Parameters<typeof api.menus.setPlacements>[0]['placements'];
type MenuItemsInput = Parameters<typeof api.menus.setItems>[0]['items'];

const write = spaceWrites(invalidate.menus);

/** Menu writes, each with its invalidation. */
export const menus = {
  create: write.withInput((input: MenuInput) => api.menus.create(input)),
  /** Saves the menu and its entries together. */
  save: write.withSpace(
    async (
      spaceId: string,
      id: string,
      data: Omit<MenuInput, 'spaceId'>,
      items: MenuItemsInput,
    ) => {
      const saved = await api.menus.update({ spaceId, id, ...data });
      await api.menus.setItems({ spaceId, id, items });
      return saved;
    },
  ),
  /** Puts a document in the given menus, at the given spot, and out of every other one. */
  setPlacements: write.withSpace(
    async (spaceId: string, localizationId: string, placements: PlacementsInput) =>
      api.menus.setPlacements({ spaceId, localizationId, placements }),
  ),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.menus.delete({ spaceId, id });
  }),
};
