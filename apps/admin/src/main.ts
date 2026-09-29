import { provideAdminHost } from '@manablox/admin-sdk/lib/host';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp, defineAsyncComponent } from 'vue';
import App from '~/App.vue';
import { htmlToRichText } from '~/features/content/model/richtext-html';
import { bootPlugins, loadPluginCatalogue, reportPluginFailures } from '~/features/plugins/boot';
import { installAdminPlugin } from '~/features/plugins/install';
import type { PluginFailure } from '~/features/plugins/loader';
import { installTheme } from '~/lib/theme';
import { installTooltips } from '~/lib/tooltip';
import { router, waitForPlugins } from '~/router';
import { useNavStore } from '~/stores/menu';
import './style.css';

const app = createApp(App);

// The editor parts plugin screens render through the SDK.
provideAdminHost({
  FieldRenderer: defineAsyncComponent(() => import('~/components/FieldRenderer.vue')),
  FieldInput: defineAsyncComponent(() => import('~/components/FieldInput.vue')),
  FieldGrid: defineAsyncComponent(() => import('~/features/content/components/FieldGrid.vue')),
  BlockEditor: defineAsyncComponent(() => import('~/features/content/components/BlockEditor.vue')),
  BlockGridBoard: defineAsyncComponent(
    () => import('~/features/content/components/BlockGridBoard.vue'),
  ),
  htmlToRichText,
});

app.use(createPinia());
app.use(VueQueryPlugin, { queryClient });

// Plugins load while the shell mounts; each is installed as it arrives. Navigations other
// than to public pages wait for them all (see `waitForPlugins`), alongside the session.
const menu = useNavStore();
const failures: PluginFailure[] = [];
const pluginsReady = bootPlugins(({ plugin, identity }) => {
  try {
    installAdminPlugin(plugin, { router, registerMenu: menu.register }, identity);
  } catch (error) {
    const id = identity.id ?? plugin.name;
    console.error(`admin plugin ${id}`, error);
    failures.push({ id, message: error instanceof Error ? error.message : String(error) });
  }
}).then(
  (result) => {
    failures.push(...result.failures);
  },
  // Never holds navigation for good.
  (error) => {
    console.error('admin plugins', error);
    failures.push({ id: 'admin', message: error instanceof Error ? error.message : String(error) });
  },
);
waitForPlugins(pluginsReady);

app.use(router);
installTheme();
app.mount('#app');
installTooltips();
loadPluginCatalogue();
void pluginsReady.then(() => reportPluginFailures(failures));
