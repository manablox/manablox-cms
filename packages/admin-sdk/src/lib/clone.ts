import { isProxy, toRaw } from 'vue';

/** A plain deep copy; nested reactive proxies are unwrapped since `structuredClone` rejects them. */
export function plainClone<T>(value: T): T {
  const raw = isProxy(value) ? toRaw(value) : value;
  if (raw === null || typeof raw !== 'object') return raw;
  if (Array.isArray(raw)) return raw.map(plainClone) as T;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return structuredClone(raw);
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) copy[key] = plainClone((raw as Record<string, unknown>)[key]);
  return copy as T;
}
