declare module 'virtual:manablox/admin-plugins' {
  import type { AdminPlugin } from '@manablox/admin-plugin';
  export const adminPlugins: AdminPlugin[];
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<object, object, unknown>;
  export default component;
}
