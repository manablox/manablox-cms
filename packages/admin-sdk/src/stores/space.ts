import { nominationsOf } from '@manablox/core';
import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  fetchContentTypes,
  fetchFieldTypes,
  useContentTypes,
  useFieldTypes,
} from '../features/content-types/queries';
import { api } from '../lib/api';
import type { ContentTypeSummary, FieldTypeMeta, Space } from '../lib/api-types';
import { activeEnvironment } from '../lib/environment';

export type { ContentTypeSummary, FieldTypeMeta, Space } from '../lib/api-types';

/** How often the list refreshes while a space is importing. */
const IMPORT_POLL_MS = 3000;

/** The current space, locale and space list. Type accessors read the query cache. */
export const useSpaceStore = defineStore('space', () => {
  const spaces = ref<Space[]>([]);
  const currentId = useLocalStorage<string | null>('manablox.space', null);
  const locale = useLocalStorage('manablox.locale', 'en');
  const loading = ref(false);

  const current = computed(() => spaces.value.find((s) => s.id === currentId.value) ?? null);

  const typesQuery = useContentTypes(currentId);
  const fieldTypesQuery = useFieldTypes();
  const contentTypes = computed<ContentTypeSummary[]>(() => typesQuery.data.value ?? []);
  const fieldTypes = computed<FieldTypeMeta[]>(() => fieldTypesQuery.data.value ?? []);
  const contentKinds = computed(() => contentTypes.value.filter((t) => t.kind === 'content'));
  const blockKinds = computed(() => contentTypes.value.filter((t) => t.kind === 'block'));
  /** Databag types: flat records kept out of the tree. */
  const dataKinds = computed(() => contentTypes.value.filter((t) => t.kind === 'data'));
  /** Content types a document can be created as; system types have their own actions. */
  const creatableKinds = computed(() => contentKinds.value.filter((t) => !t.isSystem));
  const folderType = computed(
    () => contentTypes.value.find((t) => t.isSystem && t.name === 'folder') ?? null,
  );
  const templateType = computed(
    () => contentTypes.value.find((t) => t.isSystem && t.name === 'template') ?? null,
  );
  const isFolder = (typeId: string) => folderType.value?.id === typeId;

  /** Bootstrap: loads spaces, then the chosen space's types, so `typeById` is sync after. */
  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [spaceList] = await Promise.all([api.spaces.list(), fetchFieldTypes()]);
      spaces.value = spaceList;
      if (!currentId.value || !spaces.value.some((s) => s.id === currentId.value)) {
        currentId.value = spaces.value[0]?.id ?? null;
      }
      if (currentId.value) await fetchContentTypes(currentId.value);
    } finally {
      loading.value = false;
    }
  }

  /** Reloads the space list without the loading state. */
  async function refresh(): Promise<void> {
    spaces.value = await api.spaces.list();
    if (!currentId.value || !spaces.value.some((s) => s.id === currentId.value)) {
      currentId.value = spaces.value[0]?.id ?? null;
    }
  }

  /** The document the current space and environment serve at `/`, if one is nominated. */
  const homeContentId = computed(() => {
    const active = activeEnvironment.value;
    const stagingId = active && active.spaceId === currentId.value ? active.id : null;
    return nominationsOf(current.value?.settings, stagingId).homeContentId;
  });

  async function setHome(contentId: string | null): Promise<void> {
    if (!currentId.value) return;
    await api.spaces.setHome({ spaceId: currentId.value, contentId });
    // `settings` lives on the space row.
    spaces.value = await api.spaces.list();
  }

  const typesById = computed(() => new Map(contentTypes.value.map((t) => [t.id, t])));
  // The first type of a name wins, as a linear search would.
  const typesByName = computed(
    () => new Map(contentTypes.value.toReversed().map((t) => [t.name, t])),
  );
  const fieldTypesByName = computed(
    () => new Map(fieldTypes.value.toReversed().map((t) => [t.name, t])),
  );

  function typeById(id: string): ContentTypeSummary | null {
    return typesById.value.get(id) ?? null;
  }

  function typeByName(name: string): ContentTypeSummary | null {
    return typesByName.value.get(name) ?? null;
  }

  function fieldTypeMeta(name: string): FieldTypeMeta | null {
    return fieldTypesByName.value.get(name) ?? null;
  }

  /** A space whose import is running or failed; it takes no edits. */
  const currentImporting = computed(() => Boolean(current.value?.importStatus));

  // Refreshes while an import runs elsewhere, so its progress moves.
  let polling: number | undefined;
  watch(
    () => spaces.value.some((space) => space.importStatus === 'importing'),
    (running) => {
      window.clearInterval(polling);
      polling = running ? window.setInterval(() => void refresh(), IMPORT_POLL_MS) : undefined;
    },
  );

  // Fall back to the new space's default locale if needed.
  watch(currentId, () => {
    const available = current.value?.locales ?? ['en'];
    if (!available.includes(locale.value)) locale.value = current.value?.defaultLocale ?? 'en';
  });

  return {
    spaces,
    currentId,
    current,
    contentTypes,
    contentKinds,
    creatableKinds,
    blockKinds,
    dataKinds,
    folderType,
    templateType,
    isFolder,
    fieldTypes,
    locale,
    loading,
    homeContentId,
    currentImporting,
    setHome,
    load,
    refresh,
    typeById,
    typeByName,
    fieldTypeMeta,
  };
});
