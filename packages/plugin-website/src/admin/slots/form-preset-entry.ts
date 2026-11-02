import type { AdminSlotEntry } from '@manablox/admin-plugin';
import {
  type ContentTypeSummary,
  toast,
  useSessionStore,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { fixedFormDesign } from '../model/form-preset';
import { design } from '../queries';

const TEXTAREA = { editor: 'textarea' };

const databagOf = (draft: Record<string, unknown>): string =>
  typeof draft.databag === 'string' ? draft.databag : '';

/** Stores and publishes the design of a new fixed-form block; the type is saved either way. */
async function createFormDesign(saved: ContentTypeSummary, draft: Record<string, unknown>) {
  const spaces = useSpaceStore();
  const session = useSessionStore();
  const databag = spaces.dataKinds.find((type) => type.id === databagOf(draft));
  const spaceId = spaces.currentId;
  if (!databag || !spaceId) return;
  if (!session.can('website:write', spaceId)) {
    toast.info('Ask someone who may edit designs to add the form in the block designer.');
    return;
  }
  try {
    const row = await design.saveDraft(spaceId, {
      kind: 'block',
      key: saved.id,
      name: saved.label,
      draft: fixedFormDesign(saved, databag, spaces.locale),
      expectedVersion: 0,
    });
    if (session.can('website:publish', spaceId)) await design.publish(spaceId, row.id);
  } catch (error) {
    toast.error(
      `The block type is saved, but its form design is not: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A block whose design gets a form for the databag type picked when it is created. */
export const FORM_PRESET: AdminSlotEntry<'contentType.presets'> = {
  key: 'databag-form',
  feature: null,
  component: () => import('./FormPresetOptions.vue'),
  preset: {
    id: 'databag-form',
    kind: 'block',
    label: 'Form for one databag',
    icon: 'list-checks',
    description: 'A form that always stores in the databag type picked below.',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string' },
      { name: 'text', label: 'Text', type: 'string', settings: TEXTAREA },
    ],
  },
  validate: (draft) => (databagOf(draft) ? null : 'Pick the databag type the form stores in.'),
  afterCreate: createFormDesign,
};
