import {
  CONTENT_EVENTS,
  type ErrorDetail,
  ManabloxError,
  type Scope,
  SIGNATURE_ALGORITHMS,
  SIGNATURE_FORMATS,
  SIGNATURE_HEADER,
  type SignatureAlgorithm,
  type SignatureFormat,
  scopeSpaceId,
  slugify,
} from '@manablox/core';
import type { Repositories } from '@manablox/db';
import {
  WEBHOOK_AUTH_CREDENTIAL_KIND,
  WEBHOOK_AUTH_MODES_BY_DIRECTION,
  WEBHOOK_METHODS,
  type WebhookAuth,
  type WebhookAuthMode,
  type WebhookDirection,
} from '../../../sdk.js';
import { webhookRepos } from '../../db/index.js';
import type { WebhookInput } from './types.js';

/** Endpoint validation. Collects every problem before throwing so a form shows them all. */

export async function validateWebhookInput(
  repos: Repositories,
  scope: Scope,
  input: WebhookInput,
  ownId: string | null,
) {
  const problems: ErrorDetail[] = [];
  const add = (
    key: ErrorDetail['key'],
    path: (string | number)[],
    params?: Record<string, unknown>,
  ) => problems.push({ key, path, ...(params ? { params } : {}) });

  const name = input.name.trim();
  if (!name) add('plugins.webhooks.name.required', ['name']);

  const incoming = input.direction === 'incoming';
  const url = (input.url ?? '').trim();
  if (!incoming) {
    if (!url) add('plugins.webhooks.url.required', ['url']);
    else if (!/^https?:\/\/[^\s]+$/i.test(url)) add('plugins.webhooks.url.invalid', ['url']);
  }

  const events = incoming ? [] : (input.events ?? []);
  for (const [index, event] of events.entries()) {
    if (!(CONTENT_EVENTS as readonly string[]).includes(event)) {
      add('plugins.webhooks.event.unknown', ['events', index], { event });
    }
  }

  const headers = incoming
    ? []
    : (input.headers ?? [])
        .map((header) => ({ name: header.name.trim(), value: header.value }))
        .filter((header) => header.name || header.value.trim());
  for (const [index, header] of headers.entries()) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header.name)) {
      add('plugins.webhooks.header.nameInvalid', ['headers', index, 'name'], { name: header.name });
    }
  }

  const methods = incoming ? (input.methods?.length ? input.methods : ['POST' as const]) : [];
  for (const [index, method] of methods.entries()) {
    if (!(WEBHOOK_METHODS as readonly string[]).includes(method)) {
      add('plugins.webhooks.method.unknown', ['methods', index], { method });
    }
  }

  // Credentials are shared by the space's environments.
  const auth = await validateAuth(
    repos,
    scopeSpaceId(scope),
    input.direction,
    input.auth ?? {},
    add,
  );
  const slug = slugify(input.slug?.trim() || name);
  if (!slug) add('plugins.webhooks.slug.invalid', ['slug']);

  if (problems.length)
    throw ManabloxError.validation(problems, 'plugins.webhooks.validation.failed');

  return {
    direction: input.direction,
    name,
    slug: await uniqueSlug(repos, scope, input.direction, slug, ownId),
    description: input.description?.trim() || null,
    url: incoming ? '' : url,
    events,
    headers,
    methods,
    authMode: auth.mode,
    credentialId: auth.credentialId,
    signatureHeader: auth.signatureHeader,
    algorithm: auth.algorithm,
    signatureFormat: auth.format,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  };
}

async function validateAuth(
  repos: Repositories,
  spaceId: string,
  direction: WebhookDirection,
  input: Partial<WebhookAuth>,
  add: (
    key: ErrorDetail['key'],
    path: (string | number)[],
    params?: Record<string, unknown>,
  ) => void,
): Promise<WebhookAuth> {
  const mode = (input.mode ?? 'none') as WebhookAuthMode;
  if (!WEBHOOK_AUTH_MODES_BY_DIRECTION[direction].includes(mode)) {
    add('plugins.webhooks.auth.modeUnsupported', ['auth', 'mode'], { mode, direction });
  }

  const wanted = WEBHOOK_AUTH_CREDENTIAL_KIND[mode] ?? null;
  let credentialId = input.credentialId ?? null;
  if (wanted) {
    if (!credentialId) {
      add('plugins.webhooks.auth.credentialRequired', ['auth', 'credentialId'], { kind: wanted });
    } else {
      const credential = (await repos.credentials.listBySpace(spaceId)).find(
        (row) => row.id === credentialId,
      );
      if (!credential) {
        add('plugins.webhooks.auth.credentialRequired', ['auth', 'credentialId'], { kind: wanted });
      } else if (credential.kind !== wanted) {
        add('plugins.webhooks.auth.credentialKind', ['auth', 'credentialId'], {
          expected: wanted,
          actual: credential.kind,
        });
      }
    }
  } else {
    credentialId = null;
  }

  const signatureHeader = (input.signatureHeader ?? SIGNATURE_HEADER).trim().toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(signatureHeader)) {
    add('plugins.webhooks.auth.signatureHeaderInvalid', ['auth', 'signatureHeader']);
  }
  const algorithm = (SIGNATURE_ALGORITHMS as readonly string[]).includes(input.algorithm ?? '')
    ? (input.algorithm as SignatureAlgorithm)
    : 'sha256';
  const format = (SIGNATURE_FORMATS as readonly string[]).includes(input.format ?? '')
    ? (input.format as SignatureFormat)
    : 'prefixed';

  return { mode, credentialId, signatureHeader, algorithm, format };
}

/** Slugs are unique per environment and direction; a clash gets `-2`. */
async function uniqueSlug(
  repos: Repositories,
  scope: Scope,
  direction: WebhookDirection,
  slug: string,
  ownId: string | null,
): Promise<string> {
  const taken = new Set(
    (await webhookRepos(repos).listBySpace(scope, direction))
      .filter((row) => row.id !== ownId)
      .map((row) => row.slug),
  );
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 500; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw ManabloxError.conflict('plugins.webhooks.slug.taken', { slug });
}
