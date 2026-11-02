import type { ContentTypePlanType } from '@manablox/core';

/** The "Describe it" starter's state in the space creation form. */
export interface SpaceDesignDraft {
  /** The space whose providers design it; undefined until the form picked one. */
  source?: string | null;
  description: string;
  design: { types: ContentTypePlanType[]; notes: string; problems: string[] } | null;
  /** Names of the designed types to create. */
  selected: string[];
  copyProviders: boolean;
  /** Whether the viewer may copy the source's providers. */
  canCopy: boolean;
}

/** The starter's draft with its defaults. */
export function spaceDesignDraft(draft: Record<string, unknown>): SpaceDesignDraft {
  const typed = draft as Partial<SpaceDesignDraft>;
  return {
    ...(typed.source !== undefined ? { source: typed.source } : {}),
    description: typed.description ?? '',
    design: typed.design ?? null,
    selected: typed.selected ?? [],
    copyProviders: typed.copyProviders ?? true,
    canCopy: typed.canCopy ?? false,
  };
}

/** Why the space cannot be created yet, else null. */
export function validateSpaceDesign(draft: Record<string, unknown>): string | null {
  return spaceDesignDraft(draft).design ? null : 'Describe the space and let it be designed first.';
}

/** The ticked types, created with the space. */
export function spaceDesignPlan(draft: Record<string, unknown>): ContentTypePlanType[] {
  const { design, selected } = spaceDesignDraft(draft);
  return (design?.types ?? []).filter((type) => selected.includes(type.name));
}

/** `plugins.ai` of `spaces.create`: the space whose providers to copy, if asked for. */
export function spaceDesignData(draft: Record<string, unknown>): { copyFrom: string } | undefined {
  const { source, copyProviders, canCopy } = spaceDesignDraft(draft);
  return source && copyProviders && canCopy ? { copyFrom: source } : undefined;
}

/** The toast's end after the space was created. */
export function spaceDesignCreated(draft: Record<string, unknown>): string {
  return `with ${spaceDesignPlan(draft).length} types`;
}
