import { createHash, timingSafeEqual } from 'node:crypto';
import { ManabloxError } from '@manablox/core';
import type { PluginHelpers } from '@manablox/server';
import type { Hono } from 'hono';
import { websiteKeys } from './keys.js';
import type { WebsiteServices } from './services/index.js';
import { createSiteFormRecord, type SiteFormSubmission } from './services/site/forms.js';

/** Largest submission body accepted from a site process. */
const MAX_BODY = 128 * 1024;

/**
 * `POST /plugins/website/forms/submit`: a website process forwards a checked form submission,
 * which becomes a data record created by the `Site form` system actor. Authenticated by the
 * shared forms secret only; `x-manablox-space` names the submission's space.
 */
export function registerFormsRoute(
  app: Hono,
  helpers: PluginHelpers<WebsiteServices>,
  secret: string,
): void {
  const expected = digest(secret);

  app.post('/forms/submit', async (c) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !timingSafeEqual(digest(token), expected)) {
      throw ManabloxError.unauthorized();
    }

    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) {
      throw ManabloxError.badRequest('validation.failed', { reason: 'tooLarge' });
    }
    const submission = parseSubmission(raw);
    if (!submission || c.req.header('x-manablox-space') !== submission.spaceId) {
      throw ManabloxError.badRequest('validation.failed');
    }
    const { manablox } = helpers;
    const { core } = helpers.plugin;
    if (!(await core.spaces.isReady(submission.spaceId))) {
      throw ManabloxError.notFound('space.notFound', { id: submission.spaceId });
    }
    await manablox.controls.assertWritable(
      submission.environmentId
        ? { spaceId: submission.spaceId, environmentId: submission.environmentId }
        : submission.spaceId,
    );
    await manablox.controls.assertFeature(submission.spaceId, websiteKeys.features.forms);
    if (submission.environmentId) {
      await core.environments.admit(
        await core.environments.resolve({
          spaceId: submission.spaceId,
          environmentId: submission.environmentId,
        }),
      );
    }
    await manablox.controls.assertUsage(submission.spaceId, websiteKeys.usage.formSubmissions);
    await manablox.hooks.run(
      'website:beforeFormSubmit',
      {
        spaceId: submission.spaceId,
        databagTypeId: submission.databagTypeId,
        form: submission.form,
        locale: submission.locale,
        page: submission.page,
      },
      {
        manablox,
        spaceId: submission.spaceId,
        ...(submission.environmentId ? { environmentId: submission.environmentId } : {}),
      },
    );

    const outcome = await createSiteFormRecord(
      {
        repos: helpers.plugin.repos,
        content: core.content,
        types: (scope) => manablox.contentTypes.forSpace(scope),
        environments: core.environments,
      },
      submission,
    );
    if (!outcome.ok) return c.json({ ok: false, errors: outcome.errors }, 422);
    manablox.controls.consume(submission.spaceId, websiteKeys.usage.formSubmissions, 1);
    return c.json({ ok: true, id: outcome.id }, 201);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

function parseSubmission(raw: string): SiteFormSubmission | null {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const { spaceId, environmentId, databagTypeId, values, locale, page, origin, form, ipHash } =
    body;
  if (!text(spaceId, 36) || !UUID.test(spaceId)) return null;
  if (environmentId !== undefined && (!text(environmentId, 36) || !UUID.test(environmentId)))
    return null;
  if (!text(databagTypeId, 64) || !text(locale, 35)) return null;
  if (!text(page, 2000) || !text(origin, 260) || !text(form, 400)) return null;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  if (ipHash !== undefined && !text(ipHash, 128)) return null;
  return {
    spaceId,
    ...(environmentId !== undefined ? { environmentId } : {}),
    databagTypeId,
    values: values as Record<string, unknown>,
    locale,
    page,
    origin,
    form,
    ...(ipHash !== undefined ? { ipHash } : {}),
  };
}
