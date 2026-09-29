import { type Contribution, definePlugin } from '@manablox/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defineWorkflowAbortTrigger,
  defineWorkflowAction,
  defineWorkflowTrigger,
  type WorkflowAbortTriggerBase,
  type WorkflowRuleSet,
  type WorkflowTriggerCheck,
} from '../src/define.js';
import type { WorkflowAbortTrigger, WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { builtinContributions, builtinRegistry, WorkflowRegistry } from '../src/server/registry.js';
import { action, chain, delay, onCreated, shape } from './helpers/graph.js';
import { createWorkflowHarness, type WorkflowHarness } from './helpers/harness.js';

/** A trigger kind of a fake shop plugin: an order came in at one of its shops. */
interface OrderTrigger {
  kind: 'acme.order';
  shop: string | null;
  filter: WorkflowRuleSet | null;
}

interface OrderAbort extends WorkflowAbortTriggerBase {
  kind: 'acme.order';
  shop: string | null;
}

const SHOPS: ReadonlySet<string> = new Set(['eu', 'us']);

/** Checks a shop against the shops `lookup` found. */
const checkShop = (shop: string | null, check: WorkflowTriggerCheck<ReadonlySet<string>>) => {
  if (!shop || !check.data.has(shop)) check.add('plugins.acme.shop.unknown', ['shop'], { shop });
  return shop;
};

const orderTrigger = defineWorkflowTrigger<OrderTrigger, ReadonlySet<string>>({
  kind: 'acme.order',
  spec: {
    label: 'When an order comes in',
    hint: 'A shop takes an order.',
    aborts: true,
    context: ['order'],
    design: { fields: '"shop": "<eu or us>"', hint: 'an order came in.' },
    abortDesign: null,
  },
  lookup: async () => SHOPS,
  check: (value, check) => ({
    kind: 'acme.order',
    shop: checkShop(value.shop, check),
    filter: check.rules(value.filter, ['filter']),
  }),
  matches: (value, source) => value.shop === source,
});

const orderAbort = defineWorkflowAbortTrigger<OrderAbort, ReadonlySet<string>>({
  kind: 'acme.order',
  lookup: async () => SHOPS,
  check: (value, check) => ({ kind: 'acme.order', shop: checkShop(value.shop, check) }),
  matches: (value, source) => value.shop === source,
});

const noted: unknown[] = [];

const noteAction = defineWorkflowAction({
  type: 'acme.note',
  label: 'Note the order',
  description: '',
  icon: 'bug',
  tone: 'plain',
  group: 'data',
  inputs: [],
  ports: [],
  output: { name: 'ok', label: 'Out', type: 'json' },
  outputPaths: [],
  credential: null,
  fields: [],
  defaults: () => ({}),
  execute: async (ctx) => {
    noted.push(ctx.run.order);
    return { kind: 'ok', output: {} };
  },
});

const shop = definePlugin({
  name: '@acme/shop',
  contributions: {
    workflows: {
      actions: [noteAction],
      triggers: [orderTrigger],
      abortTriggers: [orderAbort],
      fieldKinds: [{ kind: 'acme.sku' }],
      designHints: [{ section: 'placeholders', text: '- {{ order.id }}: the order.' }],
    },
  },
});

/** The built-ins as the workflows plugin contributes them, then `extra`. */
function contributions(extra: {
  actions?: Contribution<typeof noteAction>[];
  triggers?: Contribution<typeof orderTrigger>[];
}) {
  const own = <T>(entries: readonly T[]) =>
    entries.map((entry) => ({ plugin: 'workflows', entry }));
  const builtins = builtinContributions();
  return {
    actions: [...(extra.actions ?? []), ...own(builtins.actions)],
    triggers: [...(extra.triggers ?? []), ...own(builtins.triggers)],
    abortTriggers: own(builtins.abortTriggers),
    fieldKinds: [],
    designHints: [],
  };
}

describe('the registry', () => {
  it('holds the built-in actions and kinds alone without other plugins', () => {
    const registry = builtinRegistry();
    expect(registry.triggerKinds.map((kind) => kind.kind)).toEqual([
      'event',
      'schedule',
      'call',
      'manual',
    ]);
    expect(registry.abortTriggerKinds.map((kind) => kind.kind)).toEqual(['event']);
    expect(registry.trigger('webhook')).toBeUndefined();
    expect(registry.actions.has('email')).toBe(true);
  });

  it('adds what other plugins contribute after the built-ins, each with its plugin', () => {
    const registry = new WorkflowRegistry(
      {
        ...contributions({
          actions: [{ plugin: 'acme.shop', entry: noteAction }],
          triggers: [{ plugin: 'acme.shop', entry: orderTrigger }],
        }),
        abortTriggers: [
          ...contributions({}).abortTriggers,
          { plugin: 'acme.shop', entry: orderAbort },
        ],
        fieldKinds: [{ plugin: 'acme.shop', entry: { kind: 'acme.sku' } }],
        designHints: [{ plugin: 'acme.shop', entry: { section: 'actions', text: 'Note it.' } }],
      },
      (plugin) => (plugin === 'acme.shop' ? 'plugins.acme.shop' : undefined),
    );

    expect(registry.trigger('acme.order')).toBe(orderTrigger);
    expect(registry.abortTrigger('acme.order')).toBe(orderAbort);
    expect(registry.triggerCatalog().map(({ kind, plugin }) => [kind, plugin])).toEqual([
      ['event', 'workflows'],
      ['schedule', 'workflows'],
      ['call', 'workflows'],
      ['manual', 'workflows'],
      ['acme.order', 'acme.shop'],
    ]);
    expect(registry.triggerCatalog().at(-1)).toMatchObject({ label: 'When an order comes in' });
    expect(registry.actions.get('acme.note')).toBe(noteAction);
    // A contributed action answers to its plugin's flag; the built-ins to none.
    expect(registry.actionFeature('acme.note')).toBe('plugins.acme.shop');
    expect(registry.actionFeature('email')).toBeUndefined();
    expect(registry.fieldKinds).toEqual([{ kind: 'acme.sku' }]);
    expect(registry.designHints).toEqual([{ section: 'actions', text: 'Note it.' }]);
  });

  it('lets a plugin replace a built-in action or kind of the same name', () => {
    const transform = { ...noteAction, type: 'transform.json', label: 'Shop transform' };
    const manual = { ...orderTrigger, kind: 'manual' } as unknown as typeof orderTrigger;
    const registry = new WorkflowRegistry(
      contributions({
        // Listed before the built-ins, which are registered first however they come.
        actions: [{ plugin: 'acme.shop', entry: transform }],
        triggers: [{ plugin: 'acme.shop', entry: manual }],
      }),
      () => 'plugins.acme.shop',
    );
    expect(registry.actions.get('transform.json').label).toBe('Shop transform');
    expect(registry.actions.all.filter((action) => action.type === 'transform.json')).toHaveLength(
      1,
    );
    expect(registry.actionFeature('transform.json')).toBe('plugins.acme.shop');
    expect(registry.trigger('manual')).toBe(manual);
    expect(registry.triggerCatalog().find((kind) => kind.kind === 'manual')?.plugin).toBe(
      'acme.shop',
    );
  });
});

let h: WorkflowHarness;
let environmentId: string;

const onOrder = (shopId: string, filter: WorkflowRuleSet | null = null) =>
  ({ kind: 'acme.order', shop: shopId, filter }) as unknown as WorkflowTrigger;
const abortOnOrder = (shopId: string, match: WorkflowAbortTrigger['match']) =>
  ({
    id: '',
    kind: 'acme.order',
    shop: shopId,
    filter: null,
    match,
  }) as unknown as WorkflowAbortTrigger;

describe('a contributed trigger kind', () => {
  beforeAll(async () => {
    h = await createWorkflowHarness('workflow-contributions', { plugins: [shop] });
    environmentId = (await h.repos.environments.production(h.spaceId))?.id as string;
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.engine.idle();
    noted.length = 0;
    for (const row of await workflowRepos(h.repos).workflows.listBySpace(h.spaceId)) {
      await workflowRepos(h.repos).workflows.delete(row.id);
    }
  });

  /** An order coming in at `shopId`, as the shop plugin hands it to the engine. */
  const orderIn = async (shopId: string, body: Record<string, unknown>) => {
    const outcome = await h.engine.runTrigger('acme.order', {
      source: { id: shopId, spaceId: h.spaceId, environmentId },
      event: 'acme.order',
      label: `order ${String(body.id)}`,
      context: { order: body },
    });
    await h.engine.idle();
    return outcome;
  };

  it('comes from the configured plugins, with its action and catalogue entry', async () => {
    expect(h.registry.trigger('acme.order')).toBe(orderTrigger);
    const catalog = await h.service.catalog(h.spaceId);
    expect(catalog.triggerKinds.map((kind) => kind.kind)).toContain('acme.order');
    expect(catalog.fieldKinds).toEqual(['acme.sku']);
    expect(catalog.actions.map((entry) => entry.type)).toContain('acme.note');
  });

  it('starts the workflows whose trigger the source concerns, and honours a filter', async () => {
    const eu = await h.workflow(
      'EU',
      onOrder('eu'),
      chain(shape('got', '{"id": "{{ order.id }}"}')),
    );
    const paid = await h.workflow(
      'EU paid',
      onOrder('eu', {
        match: 'all',
        rules: [{ field: 'order.status', operator: 'equals', value: 'paid' }],
      }),
      chain(shape('paid', '{}')),
    );
    const us = await h.workflow('US', onOrder('us'), chain(shape('us', '{}')));
    const created = await h.workflow('On create', onCreated, chain(shape('created', '{}')));

    const first = await orderIn('eu', { id: 'o1', status: 'open' });
    expect(first.abortedRunIds).toEqual([]);
    expect(first.runIds).toHaveLength(1);
    const [run] = await h.runsOf(eu.id);
    expect(run).toMatchObject({ id: first.runIds[0], status: 'succeeded', trigger: 'acme.order' });
    expect(run?.context.order).toEqual({ id: 'o1', status: 'open' });
    expect(run?.state.outputs.got?.value).toEqual({ id: 'o1' });
    expect(await h.runsOf(paid.id)).toHaveLength(0);
    expect(await h.runsOf(us.id)).toHaveLength(0);
    expect(await h.runsOf(created.id)).toHaveLength(0);

    const second = await orderIn('eu', { id: 'o2', status: 'paid' });
    expect(second.runIds).toHaveLength(2);
    expect(await h.runsOf(paid.id)).toHaveLength(1);
    expect(await h.runsOf(us.id)).toHaveLength(0);
  });

  it('aborts before it starts, so one start replaces the run it aborts', async () => {
    const wf = await h.workflow('Hold', onOrder('eu'), chain(delay('hold', 60)), {
      abortTriggers: [abortOnOrder('eu', { mode: 'all', runKey: '', abortKey: '' })],
    });
    const first = await orderIn('eu', { id: 'o1' });
    expect(first.abortedRunIds).toEqual([]);

    const second = await orderIn('eu', { id: 'o2' });
    expect(second.abortedRunIds).toEqual(first.runIds);
    expect(second.runIds).toHaveLength(1);
    const runs = await h.runsOf(wf.id);
    const status = (id: string | undefined) => runs.find((run) => run.id === id)?.status;
    expect(status(first.runIds[0])).toBe('aborted');
    expect(status(second.runIds[0])).toBe('waiting');
    expect(runs.find((run) => run.id === first.runIds[0])?.abort).toMatchObject({
      event: 'order o2',
    });
  });

  it('aborts only the runs whose key matches, and none of another source', async () => {
    const wf = await h.workflow('Ship', onOrder('eu'), chain(delay('pack', 60)), {
      abortTriggers: [
        abortOnOrder('us', { mode: 'key', runKey: '{{ order.id }}', abortKey: '{{ order.ref }}' }),
      ],
    });
    const one = await orderIn('eu', { id: 'o1' });
    const two = await orderIn('eu', { id: 'o2' });

    // An order at the EU shop is not what the abort trigger watches.
    expect((await orderIn('eu', { id: 'o3', ref: 'o1' })).abortedRunIds).toEqual([]);
    const cancelled = await orderIn('us', { id: 'c1', ref: 'o1' });
    expect(cancelled).toEqual({ runIds: [], abortedRunIds: one.runIds });
    const runs = await h.runsOf(wf.id);
    expect(runs.find((run) => run.id === two.runIds[0])?.status).toBe('waiting');
  });

  it('checks a trigger with its kind, and refuses a kind no plugin contributes', async () => {
    await expect(
      h.workflow('Mars', onOrder('mars'), chain(shape('a', '{}'))),
    ).rejects.toMatchObject({
      key: 'plugins.workflows.validation.failed',
      details: [
        expect.objectContaining({
          key: 'plugins.acme.shop.unknown',
          path: ['trigger', 'shop'],
          params: { shop: 'mars' },
        }),
      ],
    });
    await expect(
      h.workflow(
        'Refund',
        { kind: 'acme.refund' } as unknown as WorkflowTrigger,
        chain(shape('a', '{}')),
        { abortTriggers: [abortOnOrder('mars', { mode: 'all', runKey: '', abortKey: '' })] },
      ),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          key: 'plugins.workflows.trigger.kindUnknown',
          path: ['trigger', 'kind'],
        }),
        expect.objectContaining({
          key: 'plugins.acme.shop.unknown',
          path: ['abortTriggers', 0, 'shop'],
        }),
      ],
    });
  });

  it('runs a contributed action', async () => {
    const wf = await h.workflow('Noted', onOrder('us'), chain(action('note', 'acme.note')));
    await orderIn('us', { id: 'n1' });
    expect((await h.runsOf(wf.id))[0]?.status).toBe('succeeded');
    expect(noted).toEqual([{ id: 'n1' }]);
  });
});
