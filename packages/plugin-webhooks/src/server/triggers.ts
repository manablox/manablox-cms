import {
  SIGNATURE_ALGORITHMS,
  SIGNATURE_FORMATS,
  SIGNATURE_HEADER,
  type SignatureAlgorithm,
  type SignatureFormat,
  slugify,
} from '@manablox/core';
import type {
  WorkflowAbortTriggerKindDefinition,
  WorkflowFileRecord,
  WorkflowTriggerCheck,
  WorkflowTriggerContext,
  WorkflowTriggerDesign,
  WorkflowTriggerKindDefinition,
  WorkflowTriggerRefs,
} from '@manablox/plugin-workflows/define';
import { resolveScope } from '@manablox/services';
import type { WebhookAbortTrigger, WebhookTrigger } from '../define.js';
import {
  WEBHOOK_AUTH_MODES_BY_DIRECTION,
  WEBHOOK_METHODS,
  type WebhookAuthMode,
  type WebhookMethod,
  type WebhookView,
} from '../sdk.js';
import { type WebhookRow, webhookRepos } from './db/index.js';
import { webhookKeys } from './keys.js';
import { countListeners } from './services/index.js';

/** Incoming endpoints of the environment a check reads, by id; a lookup keeps the rows. */
type Endpoints = ReadonlySet<string> | ReadonlyMap<string, WebhookRow>;

/** What a resource sync plans for incoming endpoints: slug to id, existing or declared. */
export interface WebhookPlan {
  incoming: Map<string, string>;
}

const ABORT_MATCH =
  '"filter": null, "match": "all" | "document" | {"runKey": "<placeholder on the run, e.g. {{ nodes.create_order.body.id }}>", "abortKey": "<placeholder on the abort, e.g. {{ payload.body.orderId }}>"}';

/** A header name a signature may travel in. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Incoming endpoints of the environment. */
const lookup = async ({ repos, scope }: WorkflowTriggerContext): Promise<Endpoints> =>
  new Map((await webhookRepos(repos).listBySpace(scope, 'incoming')).map((row) => [row.id, row]));

/** The same from a resource sync's plan, declared endpoints included. */
const planned = (part: <P>(kind: string) => P | undefined): Endpoints =>
  new Set(part<WebhookPlan>('webhooks.webhook')?.incoming.values() ?? []);

/** Checks an endpoint id against the environment's endpoints. */
function checkEndpoint(
  webhookId: string | null,
  check: WorkflowTriggerCheck<Endpoints>,
  keys: { required: `plugins.webhooks.${string}`; notFound: `plugins.webhooks.${string}` },
): string | null {
  if (!webhookId) check.add(keys.required, ['webhookId']);
  else if (!check.data?.has(webhookId) && !check.planned.has(webhookId)) {
    check.add(keys.notFound, ['webhookId'], { webhookId });
  }
  return webhookId ?? null;
}

/** The incoming webhook the model names, by name, slug or id. */
function webhookOf(
  raw: Record<string, unknown>,
  { catalog }: WorkflowTriggerDesign,
  problems: string[],
): string | null {
  const wanted = String(raw.webhook ?? raw.webhookId ?? '');
  const hooks = (catalog as WebhookView[] | undefined) ?? [];
  const hook = hooks.find(
    (entry) => entry.name === wanted || entry.slug === wanted || entry.id === wanted,
  );
  if (!hook) problems.push(`There is no incoming webhook "${wanted}".`);
  return hook?.id ?? null;
}

/** Workflows point at endpoints by id; files carry them as `webhooks`. */
function refs<T extends { webhookId: string | null }>(): WorkflowTriggerRefs<T> {
  return {
    file: 'webhooks',
    noun: 'webhook',
    ids: (trigger) => (trigger.webhookId ? [trigger.webhookId] : []),
    remap: (trigger, id) => ({
      ...trigger,
      webhookId: trigger.webhookId ? id(trigger.webhookId) : null,
    }),
  };
}

/** An incoming endpoint in a workflow file, without secrets; matched by slug on import. */
interface WebhookFileRecord extends WorkflowFileRecord {
  description: string | null;
  methods: WebhookMethod[];
  authMode: WebhookAuthMode;
  /** A credential of the file. */
  credentialId: string | null;
  signatureHeader: string;
  algorithm: SignatureAlgorithm;
  signatureFormat: SignatureFormat;
}

/** An endpoint with an unknown auth mode is left out rather than opened up. */
function readWebhookRecords(value: unknown): WebhookFileRecord[] {
  return (Array.isArray(value) ? value : [])
    .filter(isObject)
    .filter(
      (entry) =>
        str(entry.id) &&
        slugify(str(entry.slug)) &&
        // A space export's section holds outgoing endpoints too.
        (entry.direction === undefined || entry.direction === 'incoming') &&
        WEBHOOK_AUTH_MODES_BY_DIRECTION.incoming.includes(entry.authMode as WebhookAuthMode),
    )
    .map((entry) => {
      const header = str(entry.signatureHeader).trim().toLowerCase();
      return {
        id: str(entry.id),
        name: str(entry.name).trim().slice(0, 200) || slugify(str(entry.slug)),
        slug: slugify(str(entry.slug)),
        description:
          typeof entry.description === 'string' ? entry.description.slice(0, 2000) : null,
        methods: (Array.isArray(entry.methods) ? entry.methods : []).filter(
          (method): method is WebhookMethod =>
            (WEBHOOK_METHODS as readonly unknown[]).includes(method),
        ),
        authMode: entry.authMode as WebhookAuthMode,
        credentialId: typeof entry.credentialId === 'string' ? entry.credentialId : null,
        signatureHeader: HEADER_NAME.test(header) ? header : SIGNATURE_HEADER,
        algorithm: oneOf<SignatureAlgorithm>(SIGNATURE_ALGORITHMS, entry.algorithm, 'sha256'),
        signatureFormat: oneOf<SignatureFormat>(
          SIGNATURE_FORMATS,
          entry.signatureFormat,
          'prefixed',
        ),
      };
    });
}

/** The `webhook` trigger and abort trigger kinds the plugin contributes to workflows. */
export function webhookTriggerKinds() {
  return { trigger: webhookTrigger(), abort: webhookAbortTrigger() };
}

type WebhookTriggerKind = WorkflowTriggerKindDefinition<WebhookTrigger, Endpoints>;

function webhookTrigger(): WebhookTriggerKind {
  return {
    kind: 'webhook',
    spec: {
      label: 'When a webhook is called',
      hint: 'Another system calls a URL of this space.',
      aborts: true,
      context: ['webhook', 'payload', 'headers'],
      design: {
        fields: '"webhook": "<name of an incoming webhook>", "filter": null',
        hint: 'an incoming webhook was called.',
      },
      abortDesign: {
        fields: `"webhook": "<name of an incoming webhook>", ${ABORT_MATCH}`,
        hint: 'stops the active runs when an incoming webhook is called.',
      },
    },
    lookup,
    planned,
    check: (value, check) => ({
      kind: 'webhook',
      webhookId: checkEndpoint(value.webhookId, check, {
        required: 'plugins.webhooks.trigger.required',
        notFound: 'plugins.webhooks.trigger.notFound',
      }),
      filter: check.rules(value.filter, ['filter']),
    }),
    matches: (value, source) => value.webhookId === source,
    // A stand-in call, so `{{ payload.* }}` has the expected shape.
    sample: (value, sample) => ({
      webhook: { id: value.webhookId ?? '', name: 'Test call', slug: 'test' },
      payload: sample.payload ?? { body: { test: true }, query: {}, method: 'POST' },
      headers: sample.headers ?? {},
    }),
    refs: refs<WebhookTrigger>(),
    file: webhookFile(),
    catalog,
    design: {
      prompt: (catalog) => {
        const names = ((catalog as WebhookView[] | undefined) ?? []).map(
          (hook) => `"${hook.name}"`,
        );
        return names.length
          ? [`- Incoming webhooks, by name: ${names.join(', ')}.`]
          : ['- A webhook trigger is not possible: the space has no incoming endpoints.'];
      },
      read: (raw, design, problems) => ({
        kind: 'webhook',
        webhookId: webhookOf(raw, design, problems),
        filter: null,
      }),
    },
  };
}

function webhookAbortTrigger(): WorkflowAbortTriggerKindDefinition<WebhookAbortTrigger, Endpoints> {
  return {
    kind: 'webhook',
    lookup,
    planned,
    check: (value, check) => ({
      kind: 'webhook',
      webhookId: checkEndpoint(value.webhookId, check, {
        required: 'plugins.webhooks.abort.required',
        notFound: 'plugins.webhooks.abort.notFound',
      }),
    }),
    matches: (value, source) => value.webhookId === source,
    refs: refs<WebhookAbortTrigger>(),
    design: {
      read: (raw, design, problems) => ({
        kind: 'webhook',
        webhookId: webhookOf(raw, design, problems),
      }),
    },
  };
}

/** Incoming endpoints in workflow files and space exports: read, matched and created. */
function webhookFile(): NonNullable<WebhookTriggerKind['file']> {
  return {
    async export({ repos, scope }, ids) {
      const rows = await webhookRepos(repos).listBySpace(scope, 'incoming');
      return rows
        .filter((row) => ids.includes(row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          methods: row.methods,
          authMode: row.authMode,
          credentialId: row.credentialId,
          signatureHeader: row.signatureHeader,
          algorithm: row.algorithm,
          signatureFormat: row.signatureFormat,
        }));
    },
    read: readWebhookRecords,
    credentials: (record) => (typeof record.credentialId === 'string' ? [record.credentialId] : []),
    existing: async ({ repos, scope }) =>
      (await webhookRepos(repos).listBySpace(scope, 'incoming')).map((row) => ({
        id: row.id,
        slug: row.slug,
      })),
    create: (record, id, credential) => ({
      record: {
        ...record,
        id,
        credentialId:
          typeof record.credentialId === 'string' ? credential(record.credentialId) : null,
      },
      note: `Created the incoming webhook "${record.name}", switched off.`,
    }),
    async write({ manablox, repos, scope, via }, records) {
      // On the import's transaction, so a failed import leaves no endpoint behind.
      const service = manablox.plugins.require('webhooks').webhooks.using(repos);
      for (const record of records as WebhookFileRecord[]) {
        await service.create(
          scope,
          {
            direction: 'incoming',
            name: record.name,
            slug: record.slug,
            description: record.description,
            methods: record.methods,
            auth: {
              mode: record.authMode,
              credentialId: record.credentialId,
              signatureHeader: record.signatureHeader,
              algorithm: record.algorithm,
              format: record.signatureFormat,
            },
            enabled: false,
          },
          { id: record.id, via },
        );
      }
    },
    limit: webhookKeys.limits.count,
    // A space export carries every endpoint in the plugin's section.
    section: 'webhooks.webhooks',
  };
}

/** From the endpoints the lookup read and the catalogue's workflows. */
const catalog: NonNullable<WebhookTriggerKind['catalog']> = async ({
  manablox,
  repos,
  scope,
  data,
  workflows,
}) => {
  const service = manablox.plugins.require('webhooks').webhooks;
  const [rows, resolved] = await Promise.all([
    data instanceof Map ? [...data.values()] : webhookRepos(repos).listBySpace(scope, 'incoming'),
    resolveScope(repos, scope),
  ]);
  const staging = typeof resolved !== 'string' && !resolved.production;
  return service.views(rows, countListeners(workflows), staging ? resolved.machineName : null);
};
