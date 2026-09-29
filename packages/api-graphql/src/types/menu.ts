import type { ContentRow } from '@manablox/db';
import type { PublicMenu, PublicMenuItem } from '@manablox/services';
import type { Builder, ImplementableRefOf, InterfaceRefOf } from '../builder.js';

/** The `Menu` type; its entry type is implemented once `ContentNode` exists. */
export function defineMenuRefs(builder: Builder) {
  /** A menu entry: a document for the requested locale, or a plain link. */
  const menuItemRef = builder.objectRef<PublicMenuItem>('MenuItem');
  const menuRef = builder.objectRef<PublicMenu>('Menu').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      machineName: t.exposeString('machineName'),
      items: t.field({ type: [menuItemRef], resolve: (menu) => menu.items }),
    }),
  });
  return { menuItemRef, menuRef };
}

export function implementMenuItem(
  menuItemRef: ImplementableRefOf<PublicMenuItem>,
  contentInterface: InterfaceRefOf<ContentRow>,
): void {
  menuItemRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      /** The override when set, the document's title otherwise. */
      label: t.exposeString('label'),
      /** Set for a link entry; a content entry's address is `content.permalink`. */
      url: t.exposeString('url', { nullable: true }),
      /** The HTML target the site should render: `_self` or `_blank`. */
      target: t.exposeString('target'),
      content: t.field({
        type: contentInterface,
        nullable: true,
        resolve: (item) => item.content,
      }),
      children: t.field({ type: [menuItemRef], resolve: (item) => item.children }),
    }),
  });
}
