import { confirmChoice } from '@manablox/admin-sdk/lib/confirm';

/** What a duplicate takes along: the document alone, or its subtree with it. */
export type DuplicateScope = 'single' | 'subtree';

/** Asked before duplicating a document that has children. `null` when dismissed. */
export function duplicateChoice(title: string): Promise<DuplicateScope | null> {
  return confirmChoice<DuplicateScope>({
    title: `Duplicate "${title}"?`,
    message: 'It has documents beneath it. Choose what the copy takes along.',
    choices: [
      {
        value: 'single',
        label: 'This document only',
        description: 'The copy starts without children.',
      },
      {
        value: 'subtree',
        label: 'This document and everything beneath it',
        description: 'Every document below it is copied as well, at any depth.',
      },
    ],
    confirmLabel: 'Duplicate',
  });
}
