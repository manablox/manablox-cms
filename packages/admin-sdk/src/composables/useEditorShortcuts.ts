import type { Shortcut } from '../lib/shortcuts';
import { useShortcuts } from './useShortcuts';

export interface EditorShortcuts {
  save?: () => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
}

/** Save, undo and redo for editors; all fire while typing. */
export function useEditorShortcuts(shortcuts: EditorShortcuts): void {
  useShortcuts(
    () => {
      const list: Shortcut[] = [];
      if (shortcuts.save) {
        list.push({ keys: 'mod+s', label: 'Save', whileTyping: true, run: shortcuts.save });
      }
      if (shortcuts.undo) {
        list.push({
          keys: 'mod+z',
          label: 'Undo',
          whileTyping: true,
          enabled: shortcuts.canUndo ?? true,
          run: shortcuts.undo,
        });
      }
      if (shortcuts.redo) {
        list.push({
          keys: 'mod+shift+z',
          label: 'Redo',
          whileTyping: true,
          enabled: shortcuts.canRedo ?? true,
          run: shortcuts.redo,
        });
      }
      return list;
    },
    { group: 'Editing', order: 20 },
  );
}
