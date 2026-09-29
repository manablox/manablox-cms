import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import {
  type FieldContextDocument,
  provideFieldContext,
} from '@manablox/admin-sdk/lib/field-context';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useDraftStore } from './useDraftStore';

/**
 * The document editor's context for every nested field input, and its fields by zone.
 */
export function useDocumentFieldContext(options: {
  contentType: MaybeRefOrGetter<ContentTypeSummary | null>;
  canWrite: MaybeRefOrGetter<boolean>;
}) {
  const spaces = useSpaceStore();
  const draft = useDraftStore();

  // Editor context for every nested field input.
  provideFieldContext(() => ({
    spaceId: spaces.currentId,
    locale: spaces.locale,
    errorFor: draft.errorFor,
    errorUnder: draft.errorUnder,
    readOnly: !toValue(options.canWrite),
    typeById: spaces.typeById,
    typeByName: spaces.typeByName,
    blockTypes: () => spaces.blockKinds,
    fieldTypeMeta: spaces.fieldTypeMeta,
    blockInspectors: true,
    // The document around the fields, for plugins' inputs and field actions.
    extensions: draft.doc
      ? {
          document: {
            type: toValue(options.contentType),
            title: draft.doc.title,
            fields: draft.doc.fields,
          } satisfies FieldContextDocument,
        }
      : {},
  }));

  const inZone = (zone: 'main' | 'sidebar') =>
    (toValue(options.contentType)?.fields ?? [])
      .filter((f) => f.admin.zone === zone)
      .sort((a, b) => a.admin.position - b.admin.position);

  return {
    mainFields: computed(() => inZone('main')),
    sidebarFields: computed(() => inZone('sidebar')),
  };
}
