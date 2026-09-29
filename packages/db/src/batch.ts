/** Postgres' 16-bit bind parameter count; the driver refuses at 65534. */
const MAX_PARAMETERS = 65534;

/** Room for parameters bound beside the rows. */
const HEADROOM = 512;

/** Slices `rows` so `columns` parameters per row stay under `maxParameters`. */
export function batches<T>(
  rows: readonly T[],
  columns: number,
  maxParameters = MAX_PARAMETERS,
): T[][] {
  const size = Math.max(1, Math.floor((maxParameters - HEADROOM) / Math.max(1, columns)));
  const out: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    out.push(rows.slice(offset, offset + size) as T[]);
  }
  return out;
}
