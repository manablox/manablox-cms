<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useLoad } from './composables/useLoad.js';
import { useManablox } from './lib/manablox.js';

const cms = useManablox();
const route = useRoute();
// The "main" menu, as edited in the admin under Menus. `item.href` is the link's URL for
// a link entry and the document's permalink for a content entry, so one component serves
// both; an external link would want a plain `<a>` - check `item.url` to tell them apart.
const { data: menu } = useLoad(() => 'menu:main', () => cms.menu('main'));
</script>

<template>
  <div class="site">
    <nav v-if="route.path !== '/preview'">
      <RouterLink
        v-for="item in menu?.items ?? []"
        :key="item.id"
        :to="item.href ?? '#'"
        :aria-current="item.href === route.path ? 'page' : undefined"
        :target="item.target === '_blank' ? '_blank' : undefined"
        :rel="item.target === '_blank' ? 'noreferrer' : undefined"
      >
        {{ item.label }}
      </RouterLink>
    </nav>
    <main>
      <RouterView />
    </main>
  </div>
</template>
