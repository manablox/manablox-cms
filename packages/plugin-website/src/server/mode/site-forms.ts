import { type Controls, configRateRule } from '@manablox/core';
import { clientIp, rateLimitHeaders } from '@manablox/server';
import { FORM_FIELDS } from '@manablox/site-renderer';
import type { Context, Env, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WEBSITE } from '../../shared/site.js';
import { websiteKeys } from '../keys.js';
import type { SiteContext, SiteLookup } from '../services/site/context.js';
import {
  hashClientIp,
  isSiteFormKind,
  readSiteForm,
  SITE_FORM_LIMITS,
  type SiteFormSubmission,
  signSiteFormResult,
  siteFormFields,
  verifySiteFormType,
} from '../services/site/forms.js';
import type { SiteLoader } from '../services/site/loader.js';
import { type WebsiteConfig, websiteFormsSecret } from '../services/site/options.js';

/** What the management API answered to a forwarded submission. */
export type SiteFormForwardResult =
  | { ok: true }
  /** `errors` by field name, when the record failed validation. */
  | { ok: false; status: number; errors?: Record<string, string> | undefined };

/** Hands a checked submission to the management API. */
export type SiteFormForwarder = (submission: SiteFormSubmission) => Promise<SiteFormForwardResult>;

/** Query parameter carrying a signed form result to the page after a no-JS post. */
export const FORM_RESULT_PARAM = '_mb_form';

/** Shortest plausible time between loading a form and sending it. */
const MIN_FILL_MS = 2000;
const DEFAULT_TIMEOUT = 10_000;
const NO_STORE = 'private, no-store';

const MESSAGES = {
  disabled: 'Forms are not available on this site.',
  unavailable: 'This form is unavailable right now. Please try again later.',
  tooFast: 'Please take a moment to fill in the form, then send it again.',
  rateLimited: 'Too many submissions. Please try again later.',
  failed: 'Sorry, the form could not be sent. Please try again later.',
  invalid: 'Please check the highlighted fields.',
  consent: 'Please agree to continue.',
} as const;

/** Where the site takes form posts. */
const FORMS_PATH = '/_manablox/forms/:kind/:key/:nodeId';

/** The management API path that takes forwarded submissions. */
const FORMS_SUBMIT_PATH = `/plugins/${WEBSITE}/forms/submit`;

/** Posts submissions to `POST <apiUrl>/plugins/website/forms/submit` with the shared secret. */
export function httpFormForwarder(options: {
  apiUrl: string;
  secret: string;
  timeout?: number | undefined;
  fetch?: typeof fetch | undefined;
}): SiteFormForwarder {
  const endpoint = `${options.apiUrl.replace(/\/+$/, '')}${FORMS_SUBMIT_PATH}`;
  const send = options.fetch ?? fetch;
  return async (submission) => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.secret}`,
        'x-manablox-space': submission.spaceId,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(submission),
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT),
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as {
      errors?: Record<string, string>;
    } | null;
    const errors =
      response.status === 422 && body?.errors && typeof body.errors === 'object'
        ? body.errors
        : undefined;
    return { ok: false, status: response.status, errors };
  };
}

/** The forwarder configured for a website process, or `null` when forms are off. */
export function configuredFormForwarder(config: WebsiteConfig): SiteFormForwarder | null {
  const secret = websiteFormsSecret(config);
  const apiUrl = config.forms?.apiUrl;
  if (!secret || !apiUrl || !URL.canParse(apiUrl)) return null;
  return httpFormForwarder({ apiUrl, secret, timeout: config.forms?.timeout });
}

export interface SiteFormsOptions {
  loader: SiteLoader;
  lookup: (c: Context) => Promise<SiteLookup>;
  protocolOf: (c: Context) => string;
  /** Signs the result tokens and hashes client IPs. */
  secret: string;
  forwarder: SiteFormForwarder | null;
  config: WebsiteConfig;
  /** Counts `forms.ip` and `forms.space`. */
  controls: () => Controls;
  onError: (error: unknown) => void;
  notFound: (c: Context) => Response;
  /** Whether `siteForms` is on in the space. */
  enabled: (spaceId: string) => Promise<boolean>;
  /** Whether the space's usage stops submissions for now. */
  usageBlocked?: ((spaceId: string) => Promise<boolean>) | undefined;
}

/**
 * `POST /_manablox/forms/:kind/:key/:nodeId`: checks a submission against the published
 * form and forwards it. Answers JSON to the form island, else redirects back (303) with a
 * signed result the page shows.
 */
export function mountSiteForms(app: Hono, options: SiteFormsOptions): void {
  // `forms.rateLimit` stands in for the default of `forms.ip`.
  const ipFallback = configRateRule(options.config.forms?.rateLimit);

  // Also bounds bodies sent without a length, before anything reads them.
  const limitBody = bodyLimit({
    maxSize: SITE_FORM_LIMITS.body,
    onError: (c) =>
      c.json({ ok: false, message: MESSAGES.failed }, 413, { 'cache-control': NO_STORE }),
  });

  app.post(FORMS_PATH, limitBody, (c) => submitSiteForm(c, options, ipFallback));
}

type FormAnswer = { message?: string; errors?: Record<string, string> };

/** A failure as JSON, for the form island. */
function answer(c: Context, status: number, body: FormAnswer): Response {
  return c.json({ ok: false, ...body }, status as 400, { 'cache-control': NO_STORE });
}

async function submitSiteForm(
  c: Context<Env, typeof FORMS_PATH>,
  options: SiteFormsOptions,
  ipFallback: ReturnType<typeof configRateRule>,
): Promise<Response> {
  const found = await options.lookup(c);
  const kind = c.req.param('kind');
  if (found.kind !== 'site' || !isSiteFormKind(kind)) return options.notFound(c);
  const { context } = found;
  if (!(await options.enabled(context.space.id))) return options.notFound(c);
  const json = (c.req.header('accept') ?? '').includes('application/json');

  if (!options.forwarder) return answer(c, 503, { message: MESSAGES.disabled });
  const params = await readFormBody(c);
  if (params instanceof Response) return params;

  const key = c.req.param('key');
  const nodeId = c.req.param('nodeId');
  // A form bound to a field names its databag type in a token signed at render.
  const typeToken = params.get(FORM_FIELDS.databag);
  const boundTypeId = typeToken
    ? verifySiteFormType(options.secret, `${kind}:${key}:${nodeId}`, typeToken)
    : null;
  const form = await options.loader.form(context, kind, key, nodeId, boundTypeId);
  if (!form) return options.notFound(c);

  const reply = formReplies(c, options.secret, {
    json,
    page: safePath(params.get(FORM_FIELDS.page)),
    spaceId: context.space.id,
    form: form.ref,
  });
  const ip = clientIp(c);
  const screened = await screenSubmission(options, context.space.id, ip, ipFallback, params);
  if (screened === 'bot') return reply.done();
  if (screened) return reply.fail(screened);

  const { values, errors } = readSiteForm(siteFormFields(form.node, form.type), params);
  if (form.node.props?.consent === true && params.get(FORM_FIELDS.consent) !== 'true') {
    errors[FORM_FIELDS.consent] = MESSAGES.consent;
  }
  if (Object.keys(errors).length > 0) {
    return reply.fail({ status: 422, message: MESSAGES.invalid, errors });
  }

  const locale = localeOf(context, params.get(FORM_FIELDS.locale));
  let result: SiteFormForwardResult;
  try {
    result = await options.forwarder({
      spaceId: context.space.id,
      ...(context.scope.production ? {} : { environmentId: context.scope.environmentId }),
      databagTypeId: form.type.id,
      values,
      locale,
      page: reply.page,
      origin: context.host.hostname,
      form: form.ref,
      ipHash: hashClientIp(options.secret, ip),
    });
  } catch (error) {
    options.onError(error);
    return reply.fail({ status: 502, message: MESSAGES.failed });
  }
  if (!result.ok) {
    if (result.errors) {
      return reply.fail({ status: 422, message: MESSAGES.invalid, errors: result.errors });
    }
    if (result.status === 429) return reply.fail({ status: 503, message: MESSAGES.unavailable });
    return reply.fail({ status: 502, message: MESSAGES.failed });
  }

  const targetId = form.node.props?.redirectContentId;
  const redirect =
    typeof targetId === 'string' && targetId
      ? await options.loader.documentHref(context, targetId, locale, options.protocolOf(c))
      : null;
  return reply.done({ redirect });
}

/** The posted fields, or the refusal of a cross-origin, mistyped or oversized post. */
async function readFormBody(c: Context): Promise<URLSearchParams | Response> {
  if (!sameOrigin(c)) return answer(c, 403, { message: MESSAGES.failed });
  const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded')
    return answer(c, 415, { message: MESSAGES.failed });
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > SITE_FORM_LIMITS.body) return answer(c, 413, { message: MESSAGES.failed });
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > SITE_FORM_LIMITS.body)
    return answer(c, 413, { message: MESSAGES.failed });
  return new URLSearchParams(raw);
}

type FormFailure = { status: number; headers?: Record<string, string> } & FormAnswer;

/**
 * Usage, rate limits, the honeypot and the fill time, before the form is read: a failure,
 * `bot` for a filled honeypot (told the post went through), else `null`.
 */
async function screenSubmission(
  options: SiteFormsOptions,
  spaceId: string,
  ip: string,
  ipFallback: ReturnType<typeof configRateRule>,
  params: URLSearchParams,
): Promise<FormFailure | 'bot' | null> {
  if (await options.usageBlocked?.(spaceId)) {
    return { status: 503, message: MESSAGES.unavailable };
  }
  const decision = await options.controls().rate(spaceId, [
    { rule: websiteKeys.rateLimits['forms.ip'], key: ip, fallback: ipFallback },
    { rule: websiteKeys.rateLimits['forms.space'], key: spaceId },
  ]);
  if (decision && !decision.allowed) {
    return {
      status: 429,
      message: MESSAGES.rateLimited,
      headers: rateLimitHeaders(decision),
    };
  }
  // A filled honeypot is a bot.
  if ((params.get(FORM_FIELDS.honeypot) ?? '') !== '') return 'bot';
  if (fillTime(params) < MIN_FILL_MS) {
    return { status: 400, message: MESSAGES.tooFast };
  }
  return null;
}

/**
 * The answers of a checked submission: JSON for the island, else a redirect (303) back to
 * the page with a signed result, or to the form's target after success.
 */
function formReplies(
  c: Context,
  secret: string,
  target: { json: boolean; page: string; spaceId: string; form: string },
) {
  const back = (ok: boolean, location: string | null, body: FormAnswer = {}) =>
    new Response(null, {
      status: 303,
      headers: {
        location:
          location ??
          withResult(
            target.page,
            signSiteFormResult(secret, { spaceId: target.spaceId, form: target.form, ok, ...body }),
          ),
        'cache-control': NO_STORE,
      },
    });
  return {
    page: target.page,
    fail: ({ status, headers = {}, ...body }: FormFailure): Response => {
      const response = target.json ? answer(c, status, body) : back(false, null, body);
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      return response;
    },
    done: ({ redirect = null }: { redirect?: string | null } = {}): Response =>
      target.json
        ? c.json({ ok: true, ...(redirect ? { redirect } : {}) }, 200, {
            'cache-control': NO_STORE,
          })
        : back(true, redirect),
  };
}

/** Milliseconds the visitor spent on the form: the island's count, else since render. */
function fillTime(params: URLSearchParams): number {
  const elapsed = Number(params.get(FORM_FIELDS.elapsed) ?? '');
  if (params.has(FORM_FIELDS.elapsed) && Number.isFinite(elapsed) && elapsed >= 0) return elapsed;
  const rendered = Number(params.get(FORM_FIELDS.timestamp) ?? '');
  if (!params.get(FORM_FIELDS.timestamp) || !Number.isFinite(rendered)) return 0;
  return Date.now() - rendered;
}

/** A browser's `Origin`, when sent, must name the host the form was posted to. */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin || origin === 'null') return true;
  if (!URL.canParse(origin)) return false;
  const host = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
  return new URL(origin).host.toLowerCase() === host;
}

/** A same-site path to go back to; `/` for anything else. */
export function safePath(value: string | null): string {
  if (!value || value.length > 2000 || !value.startsWith('/') || /^\/[/\\]/.test(value)) return '/';
  const url = new URL(value, 'http://site.invalid');
  if (url.host !== 'site.invalid') return '/';
  url.searchParams.delete(FORM_RESULT_PARAM);
  // `/.//x` normalises to `//x`, which a browser reads as another host.
  if (url.pathname.startsWith('//')) return '/';
  return `${url.pathname}${url.search}`;
}

function withResult(path: string, token: string): string {
  const url = new URL(path, 'http://site.invalid');
  url.searchParams.set(FORM_RESULT_PARAM, token);
  return `${url.pathname}${url.search}`;
}

function localeOf(context: SiteContext, posted: string | null): string {
  return posted && context.space.locales.includes(posted) ? posted : context.space.defaultLocale;
}
