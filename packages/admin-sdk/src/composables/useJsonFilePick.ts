import { type Ref, ref } from 'vue';

export interface JsonFilePickOptions<T> {
  /** Reads the file; `JSON.parse` of its text by default. A throw shows `invalid`. */
  parse?: (file: File) => T | Promise<T>;
  /** Runs on every pick before reading, e.g. to drop what the last file showed. */
  reset?: () => void;
  /** Gets the read file; a returned string is shown as the error. */
  onPicked: (value: T, file: File) => unknown;
  /** The error when `parse` throws. */
  invalid?: string | ((file: File) => string);
  /** Empties the input after each pick, so a hidden one takes the same file again. */
  clear?: boolean;
}

export interface JsonFilePick {
  /** The `change` handler of an `<input type="file">`. */
  onChange: (event: Event) => Promise<void>;
  /** The picked file, while its read is the last one. */
  file: Ref<File | null>;
  /** Why the last file could not be used, else null. */
  error: Ref<string | null>;
}

/** Reads a JSON (or other) file from a file input, for import dialogs. */
export function useJsonFilePick<T = unknown>(options: JsonFilePickOptions<T>): JsonFilePick {
  const file = ref<File | null>(null);
  const error = ref<string | null>(null);

  async function onChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    if (options.clear) input.value = '';
    file.value = picked;
    error.value = null;
    options.reset?.();
    if (!picked) return;
    let value: T;
    try {
      value = options.parse ? await options.parse(picked) : (JSON.parse(await picked.text()) as T);
    } catch {
      const invalid = options.invalid ?? 'That file is not valid JSON.';
      error.value = typeof invalid === 'function' ? invalid(picked) : invalid;
      return;
    }
    const problem = await options.onPicked(value, picked);
    if (typeof problem === 'string') error.value = problem;
  }

  return { onChange, file, error };
}
