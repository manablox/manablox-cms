import { definePlugin, type PluginResourceEntry } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineResourceKind, type ResourceKindPlan } from '../src/code-resources/kinds.js';
import { SpaceConfigService } from '../src/config/service.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

/** Renders admin-built rows, skips config-owned ones, and turns ids into refs. */
let ctx: ServiceContext;
let config: SpaceConfigService;
let credentialId: string;

/** A hook a plugin keeps per space, pointing at a credential and content types. */
interface Hook {
  id: string;
  name: string;
  slug: string;
  credentialId: string | null;
  typeIds: string[];
  source: 'runtime' | 'code';
}

/** The relay plugin's rows, by space; kept in memory, as only the config export reads them. */
const hooks = new Map<string, Hook[]>();

/** A plugin whose hooks the config export writes as `relay.hook` resources. */
const relayPlugin = definePlugin({
  name: 'relay',
  resourceKinds: {
    'relay.hook': defineResourceKind<PluginResourceEntry, Hook[], ResourceKindPlan, Hook>({
      configExport: {
        label: 'Hooks',
        description: 'defineHook, one per hook.',
        define: { name: 'defineHook', from: '@acme/relay/define' },
        load: async ({ spaceId }) =>
          (hooks.get(spaceId) ?? [])
            .filter((row) => row.source === 'runtime')
            .map((row) => ({ id: row.id, label: row.name, slug: row.slug, row })),
        render: (hook, { slug, deref }) => {
          return {
            input: {
              slug,
              ...(hook.credentialId ? { credential: deref(hook.credentialId) } : {}),
              typeIds: deref(hook.typeIds),
            },
            warnings: ['the target URL stays behind'],
          };
        },
      },
    }),
  },
});

beforeAll(async () => {
  ctx = await createServiceContext('config_service', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: { plugins: [relayPlugin] },
  });
  config = new SpaceConfigService(ctx.manablox, ctx.repos);

  const credential = await ctx.repos.credentials.create({
    spaceId: ctx.spaceId,
    name: 'Mailer',
    slug: 'mailer',
    kind: 'smtp',
    data: 'sealed',
  });
  credentialId = credential.id;

  hooks.set(ctx.spaceId, [
    {
      id: crypto.randomUUID(),
      name: 'Order feed',
      slug: '',
      credentialId,
      typeIds: [ctx.ids.article as string],
      source: 'runtime',
    },
    // Config-owned, so never rendered.
    {
      id: crypto.randomUUID(),
      name: 'Declared',
      slug: 'declared',
      credentialId: null,
      typeIds: [],
      source: 'code',
    },
  ]);
});

afterAll(async () => {
  await ctx?.close();
});

describe('a space as config source', () => {
  it('counts what it can write, kind by kind', async () => {
    const inventory = await config.inventory(ctx.spaceId);

    // The suite's types are code-defined.
    expect(inventory.contentTypes).toEqual([]);
    expect(inventory.credentials.map((entry) => entry.label)).toEqual(['Mailer']);
    expect(inventory.plugins).toEqual([
      {
        kind: 'relay.hook',
        label: 'Hooks',
        description: 'defineHook, one per hook.',
        icon: null,
        entries: [{ id: expect.any(String), label: 'Order feed' }],
      },
    ]);
  });

  it('writes each kind as the call that would produce it', async () => {
    const { code, counts } = await config.source(ctx.spaceId);

    expect(counts).toMatchObject({ credentials: 1, 'relay.hook': 1 });
    expect(code).toContain('export const mailer = defineCredential({');
    expect(code).toContain("kind: 'smtp'");
    // Only the slot, never the secret.
    expect(code).not.toContain('sealed');
    expect(code).toContain('TODO: fill each credential');

    // Slug derived from the name; the provider's notes are named by it.
    expect(code).toContain("import { defineHook } from '@acme/relay/define';");
    expect(code).toContain('export const orderFeed = defineHook({');
    expect(code).toContain("slug: 'order-feed'");
    expect(code).toContain('TODO: order-feed: the target URL stays behind');
    expect(code).toContain("    'relay.hook': [orderFeed],");

    // Ids become names.
    expect(code).toContain("credential: ref.credential('mailer')");
    expect(code).toContain("ref.contentType('article')");
    expect(code).not.toContain(ctx.ids.article as string);
    expect(code).not.toContain(credentialId);
  });

  it('leaves a declaration that came from a config where it is', async () => {
    const { code } = await config.source(ctx.spaceId);

    expect(code).not.toContain('Declared');
    expect(code).not.toContain('declared');
  });

  it('writes only the kinds and entries the selection names', async () => {
    const { code, counts } = await config.source(ctx.spaceId, { kinds: ['relay.hook'] });

    expect(counts).toMatchObject({ 'relay.hook': 1, credentials: 0 });
    expect(code).toContain('defineHook({');
    expect(code).not.toContain('defineCredential({');
    // Named even when the credential is not rendered.
    expect(code).toContain("ref.credential('mailer')");
  });

  it('writes nothing of a kind whose entries were all unticked', async () => {
    const { code, counts } = await config.source(ctx.spaceId, {
      kinds: ['credentials', 'relay.hook'],
      ids: { credentials: [], 'relay.hook': [] },
    });

    expect(counts).toMatchObject({ credentials: 0, 'relay.hook': 0 });
    expect(code).toContain('credentials: []');
    expect(code).not.toContain('defineHook({');
  });
});
