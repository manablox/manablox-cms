import { useContentTypes } from '@manablox/admin-sdk/features/content-types/queries';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { blankType, type ContentTypeDraft, typeToDraft } from './model';

/**
 * The type the editor route names: its section (content or databag types), the saved type or
 * a blank one of the asked kind as the form's source, and its load state. A type opened under
 * the other section moves to its own.
 */
export function useTypeRoute() {
  const route = useRoute();
  const router = useRouter();
  const spaces = useSpaceStore();
  const types = useContentTypes();

  /** Databag types are edited under their own section; the kind follows from it. */
  const section = computed(() =>
    route.path.startsWith('/databag-types') ? '/databag-types' : '/types',
  );
  const noun = computed(() =>
    section.value === '/databag-types' ? 'databag type' : 'content type',
  );
  const isOwnRoute = () =>
    route.name === 'type-edit' ||
    route.name === 'databag-type-edit' ||
    route.name === 'type-new' ||
    route.name === 'databag-type-new';

  const routedId = computed(() => (route.params.id as string | undefined) || null);
  const existing = computed(() => (routedId.value ? spaces.typeById(routedId.value) : null));
  /** `?kind=block` from the list page's "New block type". */
  const newKind = computed(() => {
    if (section.value === '/databag-types') return 'data';
    return route.query.kind === 'block' ? 'block' : 'content';
  });

  const loading = computed(() => Boolean(routedId.value) && types.isPending.value);
  const notFound = computed(
    () =>
      Boolean(routedId.value) && !types.isPending.value && !types.error.value && !existing.value,
  );

  // A type opened under the other section moves to its own.
  watch(
    existing,
    (type) => {
      if (!type || !isOwnRoute()) return;
      const home = type.kind === 'data' ? '/databag-types' : '/types';
      if (home !== section.value) void router.replace(`${home}/${type.id}`);
    },
    { immediate: true },
  );

  const source = computed<ContentTypeDraft | null>(() => {
    // Skipped once the route moved on; the page still renders while fading out.
    if (!isOwnRoute()) return null;
    if (!routedId.value) return blankType(newKind.value);
    const type = existing.value;
    if (!type || (type.kind === 'data') !== (section.value === '/databag-types')) return null;
    return typeToDraft(type);
  });

  return { types, section, noun, routedId, existing, newKind, loading, notFound, source };
}
