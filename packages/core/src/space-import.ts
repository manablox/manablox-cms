/** A space whose import has not finished; `null` on the row means ready. */
export type SpaceImportStatus = 'importing' | 'failed';

/** Where an import stands, stored on the space while it is not ready. */
export interface SpaceImportProgress {
  /** Staging prefix id in storage. */
  id: string;
  /** Steps committed, including the one that created the space. */
  done: number;
  /** Steps in the plan plus the final one. */
  total: number;
  /** The step running next, or the one that failed. */
  step: string | null;
  /** Written as this user. */
  actorId: string | null;
  /** The transfer selection the import was started with. */
  selection: Record<string, unknown>;
  /** Whether the file is staged, so Resume needs no upload. */
  resumable: boolean;
  /** Notes of the import, e.g. why an entry was skipped. */
  notes: string[];
  /** The error key and params to translate; `message` has absolute paths masked. */
  error: { key: string; params?: Record<string, unknown>; message: string } | null;
}

/** Whether a space can be read and written normally. */
export function isSpaceReady(space: { importStatus?: string | null }): boolean {
  return !space.importStatus;
}
