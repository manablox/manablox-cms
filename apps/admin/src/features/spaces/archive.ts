import { strFromU8, Unzip, UnzipInflate } from 'fflate';

/** The manifest entry, always written first. */
const MANIFEST_NAME = 'space.json';

/** Reads only the leading manifest of an export archive. Rejects without one or for a non-zip. */
export async function readArchiveManifest(file: File): Promise<unknown> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let done = false;
  let failure: Error | null = null;

  const unzip = new Unzip((entry) => {
    if (entry.name !== MANIFEST_NAME) return;
    entry.ondata = (error, chunk, final) => {
      if (error) {
        failure = error;
        return;
      }
      chunks.push(chunk);
      if (final) done = true;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  try {
    while (!done && !failure) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      unzip.push(value, false);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (failure) throw failure;
  if (!done) throw new Error('archive.manifestMissing');

  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(strFromU8(bytes)) as unknown;
}
