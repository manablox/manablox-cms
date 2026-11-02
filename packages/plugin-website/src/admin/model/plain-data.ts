import { isProxy, toRaw } from 'vue';

/**
 * Design data is replaced, never changed in place: an edit builds new objects along the
 * changed path and shares the rest. The helpers here rely on that, so shared parts cost
 * nothing.
 */

/** A value as `JSON.stringify` sees it; `undefined` where it would leave the value out. */
function jsonForm(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    return typeof toJSON === 'function' ? (toJSON as () => unknown).call(value) : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  return value;
}

function presentKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => jsonForm(record[key]) !== undefined);
}

/**
 * Whether two values serialise to the same JSON (key order included), without serialising:
 * parts both share are equal by reference, so comparing an edited design with the one it
 * came from walks only the changed path.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = jsonForm(a) ?? null;
  const right = jsonForm(b) ?? null;
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = presentKeys(leftRecord);
  const otherKeys = presentKeys(rightRecord);
  if (keys.length !== otherKeys.length) return false;
  return keys.every(
    (key, index) => key === otherKeys[index] && jsonEqual(leftRecord[key], rightRecord[key]),
  );
}

/**
 * A copier that returns values `postMessage` can clone: reactive proxies are unwrapped,
 * objects holding one are copied, everything else is passed as it is. Results are kept per
 * object, so a design sent again after an edit is walked only along the new objects.
 */
export function plainCopier(): <T>(value: T) => T {
  const done = new WeakMap<object, unknown>();
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const raw = isProxy(value) ? toRaw(value) : value;
    if (done.has(raw)) return done.get(raw);
    let out: unknown = raw;
    if (Array.isArray(raw)) {
      const items = raw.map(copy);
      if (items.some((item, index) => item !== raw[index])) out = items;
    } else {
      const proto = Object.getPrototypeOf(raw);
      if (proto === Object.prototype || proto === null) {
        const record = raw as Record<string, unknown>;
        let copied: Record<string, unknown> | null = null;
        for (const key of Object.keys(record)) {
          const item = copy(record[key]);
          if (item !== record[key]) copied ??= { ...record };
          if (copied) copied[key] = item;
        }
        if (copied) out = copied;
      } else {
        out = structuredClone(raw);
      }
    }
    done.set(raw, out);
    return out;
  };
  return copy as <T>(value: T) => T;
}
