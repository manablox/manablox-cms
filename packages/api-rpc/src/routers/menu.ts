import { MENU_ITEM_TARGETS, type MenuItemTarget } from '@manablox/core';
import { z } from 'zod';
import { scoped } from '../base.js';
import { locale, machineName, payloadOf, spaceItem, spaceScoped, uuid } from '../schemas.js';

const menuSchema = z.object({
  name: z.string().min(1).max(200),
  machineName,
  description: z.string().max(2000).nullable().optional(),
});

/** A menu entry: a document by localization id, or a link. */
export interface MenuItemInputShape {
  id?: string | undefined;
  localizationId?: string | null | undefined;
  label?: string | null | undefined;
  url?: string | null | undefined;
  target?: MenuItemTarget | undefined;
  children?: MenuItemInputShape[] | undefined;
}

const menuItemSchema: z.ZodType<MenuItemInputShape> = z.lazy(() =>
  z.object({
    id: uuid.optional(),
    localizationId: uuid.nullable().optional(),
    label: z.string().max(200).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
    /** The target tab; defaults to the current one. */
    target: z.enum(MENU_ITEM_TARGETS as [MenuItemTarget, ...MenuItemTarget[]]).optional(),
    children: z.array(menuItemSchema).max(500).optional(),
  }),
);

/** Menus. The rules are in `MenuService`. */
export const menuRouter = {
  list: scoped('menu:read')
    .input(spaceScoped)
    .handler(async ({ context }) => context.menus.list(context.env)),

  /** The menu with content entries resolved in `locale`. */
  get: scoped('menu:read')
    .input(spaceItem.extend({ locale }))
    .handler(async ({ input, context }) => context.menus.get(context.env, input.id, input.locale)),

  create: scoped('menu:write')
    .input(menuSchema.extend(spaceScoped.shape))
    .handler(async ({ input: { environment: _environment, ...input }, context }) =>
      context.menus.create({ ...input, environmentId: context.env.environmentId }),
    ),

  update: scoped('menu:write')
    .input(menuSchema.partial().extend(spaceItem.shape))
    .handler(async ({ input, context }) => {
      const { id, ...data } = payloadOf(input);
      return context.menus.update(context.env, id, data);
    }),

  delete: scoped('menu:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.menus.delete(context.env, input.id);
      return { ok: true };
    }),

  /** Replaces the whole entry tree. */
  setItems: scoped('menu:write')
    .input(spaceItem.extend({ items: z.array(menuItemSchema).max(500) }))
    .handler(async ({ input, context }) =>
      context.menus.setItems(context.env, input.id, input.items),
    ),

  /** Every menu with the spot the document holds in it, for the editor's picker. */
  placements: scoped('menu:read')
    .input(spaceScoped.extend({ localizationId: uuid, locale }))
    .handler(async ({ input, context }) =>
      context.menus.placements(context.env, input.localizationId, input.locale),
    ),

  /** Puts a document in the named menus, at the given spot, and out of the others. */
  setPlacements: scoped('menu:write')
    .input(
      spaceScoped.extend({
        localizationId: uuid,
        placements: z
          .array(
            z.object({
              menuId: uuid,
              /** The entry to nest under; null for the top level. */
              parentId: uuid.nullable().default(null),
              index: z.number().int().min(0).max(500).default(0),
            }),
          )
          .max(100),
      }),
    )
    .handler(async ({ input, context }) =>
      context.menus.setPlacements(context.env, input.localizationId, input.placements),
    ),

  /** Menus that link a document. */
  usedIn: scoped('menu:read')
    .input(spaceScoped.extend({ localizationId: uuid }))
    .handler(async ({ input, context }) => context.menus.usedIn(context.env, input.localizationId)),
};
