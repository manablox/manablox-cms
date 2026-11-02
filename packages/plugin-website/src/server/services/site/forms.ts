import { createHash } from 'node:crypto';
import {
  type ContentTypeDefinition,
  type ErrorDetail,
  type FieldDefinition,
  ManabloxError,
  type ResolvedScope,
} from '@manablox/core';
import { runAsActor, sameSignature, signFor, systemActor } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ContentService, EnvironmentService } from '@manablox/services';
import {
  type DesignNode,
  designRoots,
  findNode,
  isFormField,
  type SiteDesignKind,
  walkNodes,
} from '@manablox/site';
import { spaceSiteSettings, WEBSITE } from '../../../shared/site.js';
import type { SiteDesignBundle } from './designs.js';

/** Design kinds a form can sit in. */
const SITE_FORM_KINDS = ['block', 'page', 'layout'] as const satisfies SiteDesignKind[];

export type SiteFormKind = (typeof SITE_FORM_KINDS)[number];

export function isSiteFormKind(value: string): value is SiteFormKind {
  return (SITE_FORM_KINDS as readonly string[]).includes(value);
}

/** A published `form` node and the data type it fills. */
export interface SiteForm {
  /**
   * `<designKind>:<designKey>:<nodeId>`, as the renderer names it; a form bound to a field
   * adds `@<databagTypeId>`.
   */
  ref: string;
  node: DesignNode;
  type: ContentTypeDefinition;
}

/** What the site forwards to the management API. */
export interface SiteFormSubmission {
  spaceId: string;
  /** The environment the form was posted in; production when absent. */
  environmentId?: string | undefined;
  databagTypeId: string;
  /** By field name. */
  values: Record<string, unknown>;
  locale: string;
  /** Path the form was posted from. */
  page: string;
  /** Host the form was posted to. */
  origin: string;
  form: string;
  /** Keyed hash of the client IP, for the audit log. */
  ipHash?: string | undefined;
}

export type SiteFormOutcome =
  | { ok: true; id: string }
  /** Messages by field name; `_form` for problems not tied to an exposed field. */
  | { ok: false; errors: Record<string, string> };

/** Upper bounds a submission is held to before it is forwarded. */
export const SITE_FORM_LIMITS = {
  /** Request body, in bytes. */
  body: 64 * 1024,
  /** Characters per text value unless the field allows fewer. */
  text: 10_000,
  /** Values of a multiple select. */
  options: 100,
} as const;

/** The `form` node of a design in the bundle, or `null`. */
export function findSiteFormNode(
  bundle: Pick<SiteDesignBundle, 'blocks' | 'pages' | 'layouts'>,
  kind: SiteFormKind,
  key: string,
  nodeId: string,
): DesignNode | null {
  const source = kind === 'block' ? bundle.blocks : kind === 'page' ? bundle.pages : bundle.layouts;
  if (!Object.hasOwn(source, key)) return null;
  for (const root of designRoots(kind, source[key])) {
    const found = findNode(root, nodeId);
    if (found) return found.node.el === 'form' ? found.node : null;
  }
  return null;
}

/** Fields a form exposes, in form order: known, fillable and not role-gated. */
export function siteFormFields(form: DesignNode, type: ContentTypeDefinition): FieldDefinition[] {
  // A form bound to a field asks for every field of the picked type.
  if (form.bind !== undefined) return type.fields.filter(fillable);
  const out: FieldDefinition[] = [];
  walkNodes(form, ({ node }) => {
    if (node.el !== 'formField') return undefined;
    const fieldId = node.props?.fieldId;
    const field = type.fields.find((entry) => entry.id === fieldId);
    if (field && fillable(field) && !out.includes(field)) out.push(field);
    return undefined;
  });
  return out;
}

/** Whether a form may write a field. */
function fillable(field: FieldDefinition): boolean {
  return isFormField(field) && !field.writeRoles?.length && !field.readRoles?.length;
}

const MESSAGES = {
  required: 'This field is required.',
  invalid: 'Please check this value.',
  number: 'Please enter a number.',
  date: 'Please enter a valid date.',
  tooLong: 'This value is too long.',
  option: 'Please choose one of the options.',
} as const;

/**
 * Posted values of the exposed fields, typed for their field; required fields must be filled.
 * The content service validates the record again when it is created.
 */
export function readSiteForm(
  fields: readonly FieldDefinition[],
  params: URLSearchParams,
): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const settings = (field.settings ?? {}) as Record<string, unknown>;
    const raw = params.get(field.name) ?? '';
    const empty = raw.trim() === '';
    const set = (value: unknown, error?: string) => {
      if (error) errors[field.name] = error;
      else values[field.name] = value;
    };
    switch (field.type) {
      case 'boolean':
        set(raw === 'true' || raw === 'on');
        continue;
      case 'select': {
        const allowed = new Set(
          (Array.isArray(settings.options) ? settings.options : [])
            .map((entry) => (entry as { value?: unknown })?.value)
            .filter((value): value is string => typeof value === 'string'),
        );
        if (settings.multiple === true) {
          const picked = params.getAll(field.name).filter((value) => value !== '');
          if (picked.length > SITE_FORM_LIMITS.options || picked.some((v) => !allowed.has(v)))
            set(null, MESSAGES.option);
          else if (picked.length === 0 && field.required) set(null, MESSAGES.required);
          else set([...new Set(picked)]);
          continue;
        }
        if (empty) set(null, field.required ? MESSAGES.required : undefined);
        else set(raw, allowed.has(raw) ? undefined : MESSAGES.option);
        continue;
      }
      default:
        break;
    }
    if (empty) {
      set(null, field.required ? MESSAGES.required : undefined);
      continue;
    }
    switch (field.type) {
      case 'number': {
        const value = Number(raw.trim());
        set(value, Number.isFinite(value) ? undefined : MESSAGES.number);
        break;
      }
      case 'date': {
        const value = raw.trim();
        if (settings.mode === 'date') {
          set(value, /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : MESSAGES.date);
        } else {
          const at = Date.parse(value);
          set(
            Number.isNaN(at) ? null : new Date(at).toISOString(),
            Number.isNaN(at) ? MESSAGES.date : undefined,
          );
        }
        break;
      }
      default: {
        const max = typeof settings.max === 'number' ? settings.max : SITE_FORM_LIMITS.text;
        set(raw, raw.length > Math.min(max, SITE_FORM_LIMITS.text) ? MESSAGES.tooLong : undefined);
      }
    }
  }
  return { values, errors };
}

// --- Management side -------------------------------------------------------

export interface SiteFormRecordDeps {
  repos: Pick<Repositories, 'spaces' | 'pluginSettings'>;
  content: ContentService;
  /** The space environment's content types. */
  types: (scope: string | ResolvedScope) => readonly ContentTypeDefinition[];
  /** Resolves a submission's environment. */
  environments: Pick<EnvironmentService, 'resolve'>;
}

/** Longest record title taken from a submitted value. */
const TITLE_MAX = 120;

/**
 * Creates the data record of a site form as the `Site form` system actor, so content hooks,
 * workflow triggers and the audit log see it like any other record.
 */
export async function createSiteFormRecord(
  deps: SiteFormRecordDeps,
  input: SiteFormSubmission,
): Promise<SiteFormOutcome> {
  const space = await deps.repos.spaces.findById(input.spaceId);
  const site = space && spaceSiteSettings(await deps.repos.pluginSettings.get(space.id, WEBSITE));
  if (!space || site?.mode !== 'designed') {
    throw ManabloxError.notFound('space.notFound', { id: input.spaceId });
  }
  const scope = input.environmentId
    ? await deps.environments.resolve({ spaceId: space.id, environmentId: input.environmentId })
    : space.id;
  const type = deps
    .types(scope)
    .find((entry) => entry.id === input.databagTypeId && entry.kind === 'data' && !entry.isSystem);
  if (!type) throw ManabloxError.notFound('contentType.notFound', { id: input.databagTypeId });

  const fields: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (fillable(field) && Object.hasOwn(input.values, field.name))
      fields[field.name] = input.values[field.name];
  }
  const locales = space.locales.includes(space.defaultLocale)
    ? space.locales
    : [space.defaultLocale, ...space.locales];
  const locale = locales.includes(input.locale) ? input.locale : space.defaultLocale;

  const actor = systemActor('Site form', {
    origin: input.origin,
    page: input.page,
    form: input.form,
    ...(input.ipHash ? { ipHash: input.ipHash } : {}),
  });
  try {
    const row = await runAsActor(actor, () =>
      deps.content.create({
        spaceId: space.id,
        ...(input.environmentId ? { environmentId: input.environmentId } : {}),
        typeId: type.id,
        locale,
        title: recordTitle(type, fields),
        fields,
      }),
    );
    return { ok: true, id: row.id };
  } catch (error) {
    if (ManabloxError.is(error) && error.kind === 'validation') {
      return { ok: false, errors: fieldErrors(error.details) };
    }
    throw error;
  }
}

/** The first filled text value, else the type's label and the time. */
function recordTitle(type: ContentTypeDefinition, values: Record<string, unknown>): string {
  for (const field of type.fields) {
    const value = values[field.name];
    if (field.type === 'string' && typeof value === 'string' && value.trim()) {
      const line = value.trim().split(/\r?\n/)[0] as string;
      return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 3)}...` : line;
    }
  }
  return `${type.label} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
}

/** Validation details as one message per field name; others under `_form`. */
function fieldErrors(details: readonly ErrorDetail[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const detail of details) {
    const name = typeof detail.path?.[0] === 'string' ? detail.path[0] : '_form';
    out[name] ??= detail.key === 'field.required' ? MESSAGES.required : MESSAGES.invalid;
  }
  return out;
}

// --- Result tokens ---------------------------------------------------------

/** How long the page after a no-JS post shows the form's result. */
const RESULT_SECONDS = 10 * 60;
const RESULT_INFO = 'manablox:site-form-result';

const resultSignature = (secret: string, body: string): string =>
  signFor(secret, RESULT_INFO, body);

/** A form post's outcome as the page after the redirect shows it. */
export interface SiteFormResult {
  form: string;
  ok: boolean;
  message?: string;
  /** Messages by field name. */
  errors?: Record<string, string>;
}

/** Bounds on what a result token carries, so its URL stays short. */
const RESULT_LIMITS = { token: 4096, errors: 30, name: 64, message: 200 } as const;

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;

/** The first few field errors, messages clipped. */
function boundedErrors(errors: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, message] of Object.entries(errors ?? {})) {
    if (Object.keys(out).length >= RESULT_LIMITS.errors) break;
    if (name.length > RESULT_LIMITS.name || typeof message !== 'string') continue;
    out[name] = clip(message, RESULT_LIMITS.message);
  }
  return out;
}

/** A form's result for the redirect back: `<body>.<signature>`, short-lived and size-bounded. */
export function signSiteFormResult(
  secret: string,
  result: { spaceId: string } & SiteFormResult,
  now = Date.now(),
): string {
  const claims: Record<string, unknown> = {
    s: result.spaceId,
    f: result.form,
    o: result.ok ? 1 : 0,
    e: Math.floor(now / 1000) + RESULT_SECONDS,
  };
  if (result.message) claims.m = clip(result.message, RESULT_LIMITS.message);
  const errors = boundedErrors(result.errors);
  if (Object.keys(errors).length > 0) claims.r = errors;
  let body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  // Too long with messages: the fields are still marked.
  if (body.length > RESULT_LIMITS.token - 100 && claims.r) {
    claims.r = Object.fromEntries(Object.keys(errors).map((name) => [name, '']));
    body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  }
  return `${body}.${resultSignature(secret, body)}`;
}

/** The result a valid, unexpired token for this space carries; `null` otherwise. */
export function verifySiteFormResult(
  secret: string,
  token: string,
  spaceId: string,
  now = Date.now(),
): SiteFormResult | null {
  if (token.length > RESULT_LIMITS.token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!sameSignature(resultSignature(secret, body), sig)) return null;
  let claims: { s?: unknown; f?: unknown; o?: unknown; e?: unknown; m?: unknown; r?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.s !== spaceId || typeof claims.f !== 'string' || typeof claims.e !== 'number')
    return null;
  if (claims.e * 1000 <= now) return null;
  const result: SiteFormResult = { form: claims.f, ok: claims.o === 1 };
  if (typeof claims.m === 'string' && claims.m) result.message = claims.m;
  if (claims.r && typeof claims.r === 'object' && !Array.isArray(claims.r)) {
    const errors = boundedErrors(claims.r as Record<string, unknown>);
    if (Object.keys(errors).length > 0) result.errors = errors;
  }
  return result;
}

// --- Databag tokens --------------------------------------------------------

const TYPE_INFO = 'manablox:site-form-type';

const typeSignature = (secret: string, ref: string, typeId: string): string =>
  signFor(secret, TYPE_INFO, `${ref}\0${typeId}`);

/**
 * The databag type a bound form was rendered with, signed for its form
 * (`<designKind>:<designKey>:<nodeId>`), so a post cannot pick another type.
 */
export function signSiteFormType(secret: string, ref: string, typeId: string): string {
  return `${typeId}.${typeSignature(secret, ref, typeId)}`;
}

/** The databag type id a valid token for this form carries; `null` otherwise. */
export function verifySiteFormType(secret: string, ref: string, token: string): string | null {
  if (token.length > 200) return null;
  const at = token.lastIndexOf('.');
  if (at <= 0) return null;
  const typeId = token.slice(0, at);
  return sameSignature(typeSignature(secret, ref, typeId), token.slice(at + 1)) ? typeId : null;
}

/** A keyed hash of a client IP: stable per instance secret, not reversible by lookup. */
export function hashClientIp(secret: string, ip: string): string {
  return createHash('sha256').update(`${secret}\0site-form-ip\0${ip}`).digest('hex').slice(0, 16);
}
