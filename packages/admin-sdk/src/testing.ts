/**
 * `@manablox/admin-sdk/testing`: the admin's state for an admin plugin's tests (happy-dom):
 * a mocked API client, a signed-in account, a current space and the plugin slots. It shares
 * its state with the main entry, so the plugin's code under test sees what a test sets here.
 */

import { createPinia, setActivePinia } from 'pinia';
import { replaceApiClient } from './lib/api';
import type { ContentTypeSummary, FieldTypeMeta, Me, Space } from './lib/api-types';
import { keys } from './lib/keys';
import { resetPluginSlots } from './lib/plugin-slots';
import { queryClient } from './lib/query-client';
import { useSessionStore } from './stores/session';
import { useSpaceStore } from './stores/space';

export type { ContentTypeSummary, FieldTypeMeta, Me, Space } from './lib/api-types';
export { exposePluginApi, resetPluginSlots } from './lib/plugin-slots';

/**
 * Procedures by router path, as nested objects: `{ contentTypes: { list } }` for the core's,
 * `{ plugins: { <id>: { ... } } }` for a plugin's. Usually `vi.fn`s.
 */
export interface MockProcedures {
  // biome-ignore lint/suspicious/noExplicitAny: a procedure of any input and output
  [name: string]: MockProcedures | ((...args: any[]) => unknown);
}

/** A path nobody mocked: it reads as a router and rejects when called. */
function mocked(procedures: MockProcedures | undefined, path: readonly string[]): object {
  return new Proxy(() => {}, {
    get(_target, key) {
      // Never a thenable or a Vue ref.
      if (typeof key === 'symbol' || key === 'then' || key.startsWith('__v_')) return undefined;
      const value = procedures?.[key];
      if (typeof value === 'function') return value;
      return mocked(value, [...path, key]);
    },
    apply: () =>
      Promise.reject(new Error(`admin API: ${path.join('.') || 'the client'} is not mocked`)),
  });
}

/**
 * Answers `api` and every `pluginClient` with `procedures` until `resetAdminApi()` or the
 * next call; a procedure that is not in it rejects. Plugin clients made at module load
 * follow it too, so call it anywhere in the test file.
 */
export function mockAdminApi(procedures: MockProcedures = {}): void {
  replaceApiClient(mocked(procedures, []));
}

/** Sends `api` back to the real link. */
export function resetAdminApi(): void {
  replaceApiClient(null);
}

/** What `testMe` switches off, for the instance and every space without its own entry. */
export interface TestFeatures {
  /** Off with a lock, as without a license. */
  locked?: readonly string[];
  /** Off and hidden. */
  hidden?: readonly string[];
  /** The lock's message. */
  message?: string;
  /** The lock's link. */
  link?: string;
}

/** An account as `users.me` returns it: an editor with no permissions, every feature on. */
export function testMe(overrides: Partial<Me> = {}, features: TestFeatures = {}): Me {
  const off = (names: readonly string[] = [], presentation: 'locked' | 'hidden') =>
    names.map((key) => [
      key,
      { presentation, message: features.message ?? null, link: features.link ?? null },
    ]);
  const base = {
    id: 'user-1',
    email: 'editor@example.com',
    name: 'Test Editor',
    image: null,
    role: 'editor',
    emailVerified: true,
    twoFactor: { enabled: false, available: true, required: false, pending: false },
    spaces: {},
    permissions: {},
    controls: {
      features: Object.fromEntries([
        ...off(features.locked, 'locked'),
        ...off(features.hidden, 'hidden'),
      ]),
      links: {},
      banners: [],
      state: { status: 'active', message: null },
      apiKeysDisable: false,
      usage: {},
      spaces: {},
    },
  } satisfies Me;
  return { ...base, ...overrides };
}

/** Signs `testMe(overrides, features)` in and returns it. */
export function createTestSession(overrides: Partial<Me> = {}, features: TestFeatures = {}): Me {
  const me = testMe(overrides, features);
  useSessionStore().me = me;
  return me;
}

export interface TestSpaceOptions {
  /** The space's content types, in the query cache the space store reads. */
  contentTypes?: ContentTypeSummary[];
  /** The field-type catalogue, likewise. */
  fieldTypes?: FieldTypeMeta[];
}

/**
 * Makes `space` (`space-1`, one `en` locale, by default) the current space, with its content
 * types and the field types in the cache, so nothing fetches them. Returns the space store;
 * its type accessors (`contentTypes`, `typeById`, ...) follow a switch of space after a tick
 * (`await nextTick()`), the space itself at once.
 */
export function useTestSpace(space: Partial<Space> = {}, options: TestSpaceOptions = {}) {
  const full: Space = {
    id: 'space-1',
    name: 'Test space',
    machineName: 'test-space',
    description: null,
    url: 'http://localhost:3000',
    locales: ['en'],
    defaultLocale: 'en',
    settings: {},
    importStatus: null,
    importProgress: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...space,
  };
  // Seeded before the store's queries see the space, so they find their data.
  queryClient.setQueryData(keys.contentTypes.list(full.id), options.contentTypes ?? []);
  queryClient.setQueryData(keys.contentTypes.fieldTypes(), options.fieldTypes ?? []);
  const store = useSpaceStore();
  store.spaces = [...store.spaces.filter((other) => other.id !== full.id), full];
  store.currentId = full.id;
  store.locale = full.defaultLocale;
  return store;
}

export interface AdminTestOptions {
  /** Mocks the API with these procedures (`mockAdminApi`); left as it is when absent. */
  api?: MockProcedures;
  /** Signs this account in (`createTestSession`). */
  me?: Partial<Me>;
  /** Makes this the current space (`useTestSpace`). */
  space?: Partial<Space>;
}

/**
 * A clean admin for one test, for `beforeEach`: a fresh Pinia, an empty query cache and no
 * plugin slots, entries or apis; then `api`, `me` and `space` when given.
 */
export function setupAdminTest(options: AdminTestOptions = {}): void {
  setActivePinia(createPinia());
  queryClient.clear();
  resetPluginSlots();
  if (options.api) mockAdminApi(options.api);
  if (options.me) createTestSession(options.me);
  if (options.space) useTestSpace(options.space);
}
