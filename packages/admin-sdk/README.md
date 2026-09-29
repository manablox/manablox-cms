# `@manablox/admin-sdk`

The building blocks of the Manablox admin, for your own admin plugins: the same buttons,
fields, dialogs, lists, stores and API client the admin's own screens are made of.

You write your plugin's screens with these parts, and they look and behave like the rest
of the admin. When the admin runs, it hands its own copy of this package to your plugin,
so your plugin bundle stays small and everything shares one state (the signed-in user,
the current space, the query cache).

## Install

```sh
npm install --save-dev @manablox/admin-sdk @manablox/admin-plugin
```

It is a development dependency: you need it for the types and the build of your plugin,
not at runtime. Build your plugin with `defineAdminPluginBuild()` from
`@manablox/admin-plugin`, which leaves this package to the admin.

## Usage

```vue
<script setup lang="ts">
import { AsyncList, PageHeader, pluginClient, useSpaceStore } from '@manablox/admin-sdk';
import { useQuery } from '@tanstack/vue-query';
import type { SeoRouter } from '../rpc';

const seo = pluginClient<SeoRouter>('acme.seo');
const spaces = useSpaceStore();
const { data, isPending, error, refetch } = useQuery({
  queryKey: ['seo', 'reports'],
  queryFn: () => seo.reports.list({ spaceId: spaces.currentId as string }),
});
</script>

<template>
  <div class="mb-page">
    <PageHeader title="SEO reports" />
    <AsyncList :pending="isPending" :items="data" :error="error" :retry="refetch" empty-title="No reports yet">
      <template #item="{ item }">{{ item.title }}</template>
    </AsyncList>
  </div>
</template>
```

## What is in it

- **Controls**: `TextField`, `TextareaField`, `NumberField`, `Select`, `Checkbox`, `Switch`, `RadioCard`, `SegmentedControl`, `ChipToggle`, `LocalePicker`, `FormField` and more. They all work with `v-model`.
- **Page parts**: `PageHeader`, `EditorHeader`, `PageState` (loading, error and not-found states), `AsyncList`, `DataTable`, `EmptyState`, `Panel`, `Tabs`, `Dialog`, `FormDialog`, `Popover`, `DropdownMenu`, `Icon`.
- **Pickers**: `ContentPicker` (documents), `AssetPicker` (files). The AI plugin lends its provider picker and wand through `usePluginApi('ai')`.
- **Feature switches**: `FeatureGate` and `FeatureLock` show a lock when a feature is switched off for the space.
- **State**: `useSpaceStore()` for the current space, its locale and its content types; `useCan(permission)` and `useFeature(key)` for what the user may do.
- **API**: `api` is the typed client of the whole management API; `pluginClient(id)` is the typed client of one plugin's procedures. `runWrite` and `confirmAndRun` run a change and show the result as a toast; `toast` and `confirm` are there on their own too.
- **Queries**: ready-made queries for content, assets, menus and content types, plus `queryClient`, `keys`, `invalidate`, `useSpaceQuery` and `useSpacePagedQuery` for your own.
- **Helpers**: dates (`formatDate`, `relativeTime`), sizes (`formatBytes`), counts (`plural`), keyboard shortcuts (`registerShortcuts`, `shortcutHint`), downloads (`downloadFile`).
- **Types**: `Space`, `ContentDocument`, `ContentTypeSummary`, `Asset`, `DraftDocument` and the option types of the controls.

The main entry is the whole public surface. Its npm version is the same as every other
`@manablox/*` package; compatibility is tracked by `SDK_API_LEVEL`, a whole number raised by
one with every breaking change. Your plugin declares the lowest level it needs as `sdkLevel`
in `defineAdminPluginBuild()`, and the admin loads it while it supports that level.

## Testing your plugin

`@manablox/admin-sdk/testing` sets up the admin's state for your plugin's admin tests, which
run in happy-dom (`pluginAdminTestConfig([vue()])` from `@manablox/config-vitest`). It shares
its state with the main entry, so your plugin's code sees what a test sets.

```ts
import { createTestSession, mockAdminApi, setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import { seoReports } from '../../src/admin/queries';

const seo = { reports: { list: vi.fn(async () => [{ id: 'r1', title: 'Home' }]) } };
mockAdminApi({ plugins: { 'acme.seo': seo } });

beforeEach(() => {
  setupAdminTest();
  useTestSpace({ id: 's1' });
  createTestSession({ permissions: { s1: ['seo:read'] } });
});

it('lists the reports of the current space', async () => {
  expect(await seoReports()).toHaveLength(1);
  expect(seo.reports.list).toHaveBeenCalledWith({ spaceId: 's1' });
});
```

- `mockAdminApi(procedures)`: `api` and every `pluginClient(id)` answer with `procedures`,
  nested by router path: `{ contentTypes: { list } }` for the core's procedures,
  `{ plugins: { <id>: { ... } } }` for a plugin's. A procedure that is not in it rejects with
  its name. Clients your code made at module load follow the mock too, so it can be called
  anywhere in the file. `resetAdminApi()` goes back to the real client.
- `setupAdminTest({ api, me, space })`: for `beforeEach`: a fresh Pinia, an empty query cache,
  no plugin slot entries or plugin apis; then mocks `api`, signs `me` in and makes `space`
  current when given.
- `createTestSession(overrides, { locked, hidden, message, link })`: signs an account in, an
  editor without permissions unless `overrides` says otherwise (`role`, `permissions` per
  space id, ...). `locked` and `hidden` switch features off, as a missing license does.
  `testMe(...)` builds the same account without signing it in.
- `useTestSpace(space, { contentTypes, fieldTypes })`: makes a space (`space-1` with the `en`
  locale unless given) current and puts its content types and the field types in the cache,
  so nothing fetches them. The space store's type accessors follow after a tick.
- `exposePluginApi(id, api)` stands in for another plugin's bundle (what `usePluginApi(id)`
  returns), and `resetPluginSlots()` drops every slot entry and plugin api.
- Types: `Me`, `Space`, `ContentTypeSummary`, `FieldTypeMeta`, `MockProcedures`.

## Styles

The controls use the admin's own classes, which are already on the page. For your own
markup, `@manablox/admin-plugin/tailwind.css` gives you Tailwind with the admin's colours,
type scale and spacing. The raw design tokens are in `@manablox/admin-sdk/styles/theme.css`.
