import type { ContentDocument } from '@manablox/admin-sdk/features/content/queries';
import { content } from '@manablox/admin-sdk/features/content/queries';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DraftDocument } from '~/features/content/useDraftStore';

export interface ContentLoaderOptions {
  draft: { open: (document: DraftDocument) => void; close: () => void };
  /** `/content`, `/templates` or `/databags/<type id>`. */
  section: () => string;
  isNew: () => boolean;
  /** A blank document was opened. */
  onBlank: () => void;
  /** A stored document was opened. */
  onLoaded: (row: ContentDocument) => void;
}

/** Opens the routed document in the draft and reloads it when the route changes. */
export function useContentLoader(options: ContentLoaderOptions) {
  const route = useRoute();
  const router = useRouter();
  const spaces = useSpaceStore();
  const { draft } = options;

  const loading = ref(true);
  /** The last load's failure; cleared by the next attempt. */
  const error = ref<unknown>(null);
  /** The routed document does not exist in this space. */
  const notFound = ref(false);
  /** Shared by every translation; menu entries point at it. */
  const localizationId = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    notFound.value = false;
    try {
      // A redirect leaves loading on; the next route's load settles it.
      if (!(await open())) return;
    } catch (caught) {
      error.value = caught;
    }
    loading.value = false;
  }

  /** False when it redirected instead of opening a document. */
  async function open(): Promise<boolean> {
    const spaceId = spaces.currentId as string;

    if (options.isNew()) {
      // On `/templates/new` the type is the system one.
      const typeId =
        route.name === 'template-new'
          ? (spaces.templateType?.id ?? '')
          : (route.params.typeId as string);
      if (!typeId) {
        await router.replace('/templates');
        return false;
      }
      const blank = await content.blank(spaceId, typeId);
      options.onBlank();
      localizationId.value = null;
      draft.open({
        spaceId,
        typeId,
        locale: spaces.locale,
        parentId: (route.query.parent as string) ?? null,
        title: '',
        slug: '',
        fields: blank.fields,
        position: 0,
        tags: [],
      });
    } else {
      const row = await content.get(spaceId, route.params.id as string);
      if (!row) {
        notFound.value = true;
        options.onBlank();
        draft.close();
        return true;
      }
      // A template or databag entry reached via a content link moves under its own section.
      if (spaces.templateType?.id === row.typeId && options.section() !== '/templates') {
        await router.replace(`/templates/${row.id}`);
        return false;
      }
      const databag = `/databags/${row.typeId}`;
      if (spaces.typeById(row.typeId)?.kind === 'data' && options.section() !== databag) {
        await router.replace(`${databag}/${row.id}`);
        return false;
      }
      options.onLoaded(row);
      localizationId.value = row.localizationId;
      draft.open({
        id: row.id,
        spaceId: row.spaceId,
        typeId: row.typeId,
        locale: row.locale,
        parentId: row.parentId,
        title: row.title,
        slug: row.slug,
        fields: row.fields as Record<string, unknown>,
        position: row.position,
        version: row.version,
        tags: row.tags.map((tag) => tag.name),
      });
    }
    return true;
  }

  onMounted(load);
  // The page outlives its route during the leave transition; a reload would fetch with no id.
  const isOwnRoute = () =>
    route.name === 'content-new' ||
    route.name === 'content-edit' ||
    route.name === 'template-new' ||
    route.name === 'template-edit' ||
    route.name === 'databag-new' ||
    route.name === 'databag-edit';
  watch(
    () => route.fullPath,
    () => {
      if (isOwnRoute()) void load();
    },
  );
  onBeforeUnmount(() => draft.close());

  return { loading, error, notFound, localizationId, load, retry: load };
}
