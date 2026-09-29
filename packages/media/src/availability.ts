/** An asset's availability window, checked on every request that serves the bytes. */
export interface AssetSchedule {
  publishAt?: Date | null | undefined;
  unpublishAt?: Date | null | undefined;
}

/** One year, the usual max-age for `Cache-Control: immutable`. */
export const IMMUTABLE_MAX_AGE = 31_536_000;

/** Whether the window is open; an asset with neither date is always available. */
export function isAvailable(asset: AssetSchedule, now = new Date()): boolean {
  if (asset.publishAt && asset.publishAt > now) return false;
  if (asset.unpublishAt && asset.unpublishAt <= now) return false;
  return true;
}

/** Seconds a cache may hold the bytes: a year, capped at the next schedule boundary. */
export function assetMaxAge(asset: AssetSchedule, now = new Date()): number {
  const boundaries = [asset.publishAt, asset.unpublishAt]
    .filter((at): at is Date => Boolean(at) && (at as Date) > now)
    .map((at) => Math.ceil((at.getTime() - now.getTime()) / 1000));
  return Math.min(IMMUTABLE_MAX_AGE, ...boundaries);
}
