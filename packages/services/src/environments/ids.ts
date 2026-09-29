import { createHash } from 'node:crypto';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The id a row copied into `environmentId` takes; the same source always gives the same id. */
export function copyId(environmentId: string, id: string): string {
  const bytes = createHash('sha1')
    .update(`manablox:environment:${environmentId}:${id.toLowerCase()}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Old id to new id; every UUID inside a value that has an entry moves with it. */
export class IdMap {
  readonly ids = new Map<string, string>();

  set(from: string, to: string): void {
    this.ids.set(from.toLowerCase(), to);
  }

  has(id: string): boolean {
    return this.ids.has(id.toLowerCase());
  }

  /** The new id, or `id` itself without an entry. */
  id(id: string): string {
    return this.ids.get(id.toLowerCase()) ?? id;
  }

  /** `value` with every mapped UUID replaced, in strings at any depth. */
  remap<T>(value: T): T {
    return this.walk(value) as T;
  }

  /** A materialised content path (`_`-separated ids joined by `.`) with its ids mapped. */
  path(path: string): string {
    return path
      .split('.')
      .map((label) => this.id(label.replaceAll('_', '-')).replaceAll('-', '_'))
      .join('.');
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') {
      // Most strings cannot hold an id; the regex runs only on those that could.
      if (value.length < 36 || !value.includes('-')) return value;
      return value.replace(UUID, (id) => this.ids.get(id.toLowerCase()) ?? id);
    }
    if (Array.isArray(value)) return value.map((entry) => this.walk(entry));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        out[this.walk(key) as string] = this.walk(entry);
      }
      return out;
    }
    return value;
  }
}
