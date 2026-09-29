import { useBreadcrumb } from '@manablox/admin-sdk/composables/useBreadcrumb';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useDraftStore } from './useDraftStore';

const BACK_LABELS: Record<string, string> = {
  '/content': 'All content',
  '/templates': 'All templates',
};

/**
 * The document editor's route: the section it belongs to (content, templates or a databag),
 * whether it creates a document, and the breadcrumb.
 */
export function useContentRoute() {
  const route = useRoute();
  const spaces = useSpaceStore();
  const draft = useDraftStore();

  /** Templates and databag entries use this editor but navigation stays inside their own section. */
  const section = computed(() => {
    if (route.path.startsWith('/templates')) return '/templates';
    if (route.path.startsWith('/databags')) return `/databags/${route.params.typeId as string}`;
    return '/content';
  });
  const isNewRoute = computed(
    () =>
      route.name === 'content-new' || route.name === 'template-new' || route.name === 'databag-new',
  );
  const backLabel = computed(() => BACK_LABELS[section.value] ?? 'All entries');

  useBreadcrumb(() => {
    if (route.name === 'template-new') return 'New template';
    if (route.name === 'content-new' || route.name === 'databag-new') {
      return `New ${spaces.typeById(route.params.typeId as string)?.label ?? 'document'}`;
    }
    return draft.doc ? draft.doc.title || 'Untitled' : null;
  });

  return { section, isNewRoute, backLabel };
}
