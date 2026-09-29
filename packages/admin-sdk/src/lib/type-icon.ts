import { ICON_NAMES } from './icon-names';

const KNOWN = new Set<string>(ICON_NAMES);

/** A content type's icon, falling back for unset or unknown names (e.g. `i-lucide-folder`). */
export function typeIcon(
  type: { icon?: string | null | undefined; kind?: string | undefined } | null | undefined,
  fallback?: string,
): string {
  if (type?.icon && KNOWN.has(type.icon)) return type.icon;
  if (fallback) return fallback;
  if (type?.kind === 'block') return 'blocks';
  return type?.kind === 'data' ? 'database' : 'doc';
}
