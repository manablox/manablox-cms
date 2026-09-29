import type { MenuItemTarget } from '@manablox/core';
import {
  type AnyTableDefinition,
  id,
  index,
  integer,
  table,
  text,
  timestamp,
  unique,
  uuid,
} from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/** A named navigation, e.g. "main" or "footer". */
export const menus = table(
  'menus',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    name: text().notNull(),
    /** Delivery API key: `menu(name: "main")`. */
    machineName: text().notNull(),
    description: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique('menus_environment_machine_name_key').on(t.environmentId, t.machineName)],
);

/**
 * A nested entry: a `localizationId` (so one menu serves every locale) or a `url`. A
 * `label` overrides the document title.
 */
export const menuItems = table(
  'menu_items',
  {
    id: id(),
    menuId: uuid()
      .notNull()
      .references(() => menus, 'id', { onDelete: 'cascade' }),
    /** Cascades to sub-entries. */
    parentId: uuid().references((): AnyTableDefinition => menuItems, 'id', { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
    localizationId: uuid(),
    label: text(),
    url: text(),
    /** HTML `target`: `_self` or `_blank`. */
    target: text<MenuItemTarget>().notNull().default('_self'),
  },
  (t) => [
    index('menu_items_menu_idx').on(t.menuId, t.parentId, t.position),
    index('menu_items_localization_idx').on(t.localizationId),
  ],
);
