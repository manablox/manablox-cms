/**
 * The automation half of a space: vault credentials, endpoints both ways round, and the
 * workflows hung off them.
 *
 * Nothing seeded is armed. Event and schedule workflows are written switched off, and
 * outgoing endpoints too, because a seed that fills the instance is not a seed that
 * should start posting to example.com or firing on every document the next run writes.
 * Incoming endpoints stay on: they do nothing until somebody calls them, and a URL that
 * answers is the point of having one. `SEED_ARM=1` turns the rest on.
 */
import {
  WORKFLOW_TRIGGER_ID,
  type WorkflowEdge,
  type WorkflowNode,
} from '@manablox/plugin-workflows/sdk';
import { chance, count, faker, freeSlug, pick, sample, sentence } from './random.mts';
import type { Credentials, Webhooks, Workflows } from './types.mts';

const ARMED = process.env.SEED_ARM === '1';

/** A vault slot per kind, so every credential form in the admin has a row to open. */
export async function buildCredentials(
  credentials: Credentials,
  spaceId: string,
  total: number,
): Promise<{ id: string; kind: string }[]> {
  const kinds = [
    {
      kind: 'apiKey',
      data: () => ({ header: 'x-api-key', key: faker.string.alphanumeric(32), prefix: '' }),
    },
    { kind: 'bearer', data: () => ({ token: faker.string.alphanumeric(40) }) },
    {
      kind: 'basic',
      data: () => ({ username: faker.internet.username(), password: faker.internet.password() }),
    },
    { kind: 'signing', data: () => ({ secret: faker.string.alphanumeric(48) }) },
    { kind: 'smtp', data: () => ({ url: 'smtp://mailpit:1025', from: faker.internet.email() }) },
    {
      kind: 'oauth2',
      data: () => ({
        tokenUrl: `https://${faker.internet.domainName()}/oauth/token`,
        clientId: faker.string.alphanumeric(20),
        clientSecret: faker.string.alphanumeric(40),
        refreshToken: faker.string.alphanumeric(60),
        scope: 'read write',
      }),
    },
  ] as const;

  const built: { id: string; kind: string }[] = [];
  for (let index = 0; index < total; index++) {
    const spec = kinds[index % kinds.length];
    if (!spec) continue;
    const row = await credentials.create(spaceId, {
      name: `${faker.company.name()} ${spec.kind}`,
      kind: spec.kind,
      data: spec.data(),
    });
    built.push({ id: row.id, kind: spec.kind });
  }
  return built;
}

const EVENTS = [
  'content.created',
  'content.updated',
  'content.saved',
  'content.deleted',
  'content.published',
  'content.unpublished',
] as const;

/**
 * Endpoints. Outgoing ones name the events they want and sign with a vault credential
 * where there is one; incoming ones get a slug, the methods they accept and a way for a
 * caller to prove itself.
 */
export async function buildWebhooks(
  webhooks: Webhooks,
  spaceId: string,
  total: number,
  credentials: { id: string; kind: string }[],
  taken: Set<string>,
): Promise<{ incoming: string[]; outgoing: string[] }> {
  const signing = credentials.filter((row) => row.kind === 'signing');
  const bearer = credentials.filter((row) => row.kind === 'bearer');
  const apiKey = credentials.filter((row) => row.kind === 'apiKey');
  const result = { incoming: [] as string[], outgoing: [] as string[] };

  for (let index = 0; index < total; index++) {
    const incoming = index % 3 === 0;
    const name = `${faker.company.buzzNoun()} ${incoming ? 'inbox' : 'sync'} ${index + 1}`;
    const slug = freeSlug(name, taken);

    if (incoming) {
      const mode = pick(['none', 'hmac', 'token', 'bearer'] as const);
      const credential =
        mode === 'hmac'
          ? signing[0]
          : mode === 'token'
            ? apiKey[0]
            : mode === 'bearer'
              ? bearer[0]
              : undefined;
      const row = await webhooks.create(spaceId, {
        direction: 'incoming',
        name,
        slug,
        description: sentence(8),
        methods: sample(['POST', 'PUT', 'GET'] as const, 1, 2),
        auth: credential ? { mode, credentialId: credential.id } : { mode: 'none' },
        enabled: true,
      });
      result.incoming.push(row.id);
      continue;
    }

    const credential = signing[index % Math.max(1, signing.length)];
    const row = await webhooks.create(spaceId, {
      direction: 'outgoing',
      name,
      slug,
      description: sentence(8),
      url: `https://${faker.internet.domainName()}/hooks/${slug}`,
      events: sample(EVENTS, 1, 4),
      headers: chance(0.4) ? [{ name: 'x-source', value: 'manablox-seed' }] : [],
      auth:
        credential && chance(0.6)
          ? { mode: 'hmac', credentialId: credential.id }
          : { mode: 'none' },
      // Off unless the run asks otherwise: a live endpoint would try to deliver every
      // save the next seed run makes to a domain that does not exist.
      enabled: ARMED,
    });
    result.outgoing.push(row.id);
  }
  return result;
}

let nodeSeq = 0;

const node = (key: string, kind: WorkflowNode['kind'], x: number, y: number) => ({
  id: `n${++nodeSeq}`,
  key: `${key}_${nodeSeq}`,
  name: '',
  enabled: true,
  continueOnError: chance(0.2),
  join: 'any' as const,
  ui: { x, y },
  kind,
});

const edge = (from: string, fromPort: string, to: string): WorkflowEdge => ({
  id: '',
  from,
  fromPort,
  to,
  guard: null,
});

/** The credential kinds `http` accepts; the other seeded actions take none at all. */
const HTTP_CREDENTIAL_KINDS = ['apiKey', 'bearer', 'basic', 'oauth2'];

/**
 * The action nodes a seeded workflow is built from, each with a config that validates.
 * A credential is only ever attached where the action takes one of that kind: the
 * validator refuses the rest, and rightly so.
 */
function actionNode(
  x: number,
  y: number,
  credentials: { id: string; kind: string }[],
): WorkflowNode {
  const kind = pick(['http', 'email', 'transform', 'push'] as const);
  const usable =
    kind === 'http' ? credentials.filter((row) => HTTP_CREDENTIAL_KINDS.includes(row.kind)) : [];
  const credentialId = usable.length && chance(0.5) ? pick(usable).id : null;
  const shared = { ...node(kind, 'action', x, y), kind: 'action' as const, credentialId };

  if (kind === 'http') {
    return {
      ...shared,
      action: 'http',
      config: {
        method: pick(['GET', 'POST', 'PUT']),
        url: `https://${faker.internet.domainName()}/api/${faker.word.noun()}`,
        headers: [{ name: 'accept', value: 'application/json' }],
        body: {
          mode: pick(['event', 'custom', 'none']),
          template: '{"title": "{{ content.title }}"}',
        },
        secret: null,
        timeoutMs: 10_000,
        allowErrorStatus: chance(0.5),
      },
    };
  }
  if (kind === 'email') {
    return {
      ...shared,
      action: 'email',
      config: {
        to: [faker.internet.email()],
        toRoles: chance(0.4) ? ['editor'] : [],
        subject: '{{ content.title }} was {{ event }}',
        body: '"{{ content.title }}" changed in {{ space.name }}.\n\n{{ url }}',
        html: chance(0.3),
      },
    };
  }
  if (kind === 'push') {
    return {
      ...shared,
      action: 'push',
      config: {
        roles: ['editor'],
        userIds: [],
        title: '{{ content.title }}',
        body: '{{ event }} in {{ space.name }}',
        url: '',
      },
    };
  }
  return {
    ...shared,
    action: 'transform.json',
    config: {
      template: '{\n  "title": "{{ content.title }}",\n  "locale": "{{ content.locale }}"\n}',
    },
  };
}

const conditionNode = (x: number, y: number): WorkflowNode => ({
  ...node('check', 'condition', x, y),
  kind: 'condition',
  match: pick(['all', 'any'] as const),
  rules: [
    {
      field: pick(['content.status', 'content.locale', 'content.title']),
      operator: pick(['equals', 'isNotEmpty', 'contains'] as const),
      value: pick(['published', 'en', 'draft']),
    },
  ],
});

const delayNode = (x: number, y: number): WorkflowNode => ({
  ...node('wait', 'delay', x, y),
  kind: 'delay',
  minutes: pick([5, 15, 60, 240, 1440]),
});

/**
 * A graph with a shape rather than a chain: a first step, then sometimes a fork whose
 * two sides do different things and sometimes a wait. Every node is reachable from the
 * trigger, which is what the validator insists on.
 */
function graph(credentials: { id: string; kind: string }[]): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  const first = actionNode(0, 0, credentials);
  nodes.push(first);
  edges.push(edge(WORKFLOW_TRIGGER_ID, 'out', first.id));

  if (chance(0.6)) {
    const fork = conditionNode(240, 0);
    nodes.push(fork);
    edges.push(edge(first.id, 'ok', fork.id));

    const yes = actionNode(480, -120, credentials);
    const no = actionNode(480, 120, credentials);
    nodes.push(yes, no);
    edges.push(edge(fork.id, 'true', yes.id), edge(fork.id, 'false', no.id));

    if (chance(0.5)) {
      const wait = delayNode(720, -120);
      const after = actionNode(960, -120, credentials);
      nodes.push(wait, after);
      edges.push(edge(yes.id, 'ok', wait.id), edge(wait.id, 'out', after.id));
    }
    // Something to do when the first step fails, on half of them.
    if (chance(0.5)) {
      const recover = actionNode(240, 240, credentials);
      nodes.push(recover);
      edges.push(edge(first.id, 'error', recover.id));
    }
    return { nodes, edges };
  }

  let previous = first;
  for (let index = 0; index < count(1, 3); index++) {
    const next = chance(0.25)
      ? delayNode(240 * (index + 1), 0)
      : actionNode(240 * (index + 1), 0, credentials);
    nodes.push(next);
    edges.push(edge(previous.id, previous.kind === 'delay' ? 'out' : 'ok', next.id));
    previous = next;
  }
  return { nodes, edges };
}

/**
 * The workflows: a third started by content changing, a third by the clock, a third by
 * one of the space's incoming endpoints being called. Only the webhook ones are switched
 * on - an armed event or schedule workflow would run against the seed itself.
 */
export async function buildWorkflows(
  workflows: Workflows,
  spaceId: string,
  total: number,
  contentTypeIds: string[],
  incomingWebhookIds: string[],
  credentials: { id: string; kind: string }[],
): Promise<number> {
  let built = 0;
  for (let index = 0; index < total; index++) {
    const kind =
      index % 3 === 0 && incomingWebhookIds.length
        ? 'webhook'
        : index % 2 === 0
          ? 'schedule'
          : 'event';
    const { nodes, edges } = graph(credentials);

    const trigger =
      kind === 'webhook'
        ? { kind: 'webhook' as const, webhookId: pick(incomingWebhookIds), filter: null }
        : kind === 'schedule'
          ? {
              kind: 'schedule' as const,
              cron: pick(['*/15 * * * *', '0 * * * *', '0 3 * * *', '30 6 * * 1', '0 0 1 * *']),
              timezone: pick(['UTC', 'Europe/Berlin', 'America/New_York']),
              selection: chance(0.6)
                ? {
                    typeIds: sample(contentTypeIds, 0, 3),
                    status: pick(['any', 'draft', 'published'] as const),
                    changedWithinHours: chance(0.5) ? count(1, 168) : null,
                    locale: null,
                  }
                : null,
              perDocument: chance(0.5),
            }
          : {
              kind: 'event' as const,
              events: sample(EVENTS, 1, 3),
              typeIds: sample(contentTypeIds, 0, 3),
              locales: [],
            };

    await workflows.create(spaceId, {
      name: `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} ${index + 1}`,
      description: sentence(10),
      // A webhook workflow waits to be called; the others would run on their own.
      enabled: kind === 'webhook' ? true : ARMED,
      trigger,
      nodes,
      edges,
    });
    built += 1;
  }
  return built;
}

/** Whether this run armed what it wrote; `main.mts` says so in the summary. */
export const armed = (): boolean => ARMED;
