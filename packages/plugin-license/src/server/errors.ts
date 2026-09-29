import {
  type ErrorDetail,
  ManabloxError,
  type PluginErrorKey,
  type PluginErrorSpec,
} from '@manablox/core';

/** The license plugin's error keys and their English sentences. */
export const licenseErrors = {
  'plugins.license.key.malformed': {
    message: 'That is not a license key. Keys look like MBX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.',
  },
  'plugins.license.key.duplicate': { kind: 'conflict', message: 'This key is added already.' },
  'plugins.license.key.notFound': {
    kind: 'not_found',
    message: 'That key is no longer on this instance.',
  },
  'plugins.license.key.fromEnvironment': {
    kind: 'forbidden',
    message: 'This key comes from MANABLOX_LICENSE_KEYS; remove it from the environment instead.',
  },
  'plugins.license.key.notActivated': { message: 'This key is not activated on this instance.' },
  'plugins.license.key.invalid': { message: 'The license server does not know this key.' },
  'plugins.license.key.revoked': { kind: 'forbidden', message: 'This license key was revoked.' },
  'plugins.license.key.noSeats': {
    kind: 'conflict',
    message:
      'Every production seat of key {keyId} is taken. Deactivate one of its instances or add a seat.',
  },
  'plugins.license.key.trialUsed': {
    kind: 'conflict',
    message: 'The trial of this product was used already.',
  },
  'plugins.license.key.bound': {
    kind: 'conflict',
    message: 'This key is bound to another instance and cannot be moved.',
  },
  'plugins.license.cliSession.notFound': {
    kind: 'not_found',
    message: 'That license session no longer exists; start again.',
  },
  'plugins.license.subscription.inactive': {
    kind: 'forbidden',
    message: 'The subscription of this key is not active.',
  },
  'plugins.license.activation.conflict': {
    kind: 'conflict',
    message: 'This license is active on another instance. Activate it again here to move it.',
  },
  'plugins.license.activation.kindMismatch': {
    kind: 'conflict',
    message:
      'A development license serves private hosts only, and this instance has public ones ({hostnames}). Activate it as production.',
  },
  'plugins.license.activation.notFound': {
    kind: 'not_found',
    message: 'The license server no longer knows this activation.',
  },
  'plugins.license.rateLimited': {
    kind: 'rate_limited',
    message: 'The license server asks to wait {retryAfter} seconds.',
  },
  'plugins.license.request.invalid': { message: 'The license server refused the request.' },
  'plugins.license.network': {
    kind: 'unavailable',
    message: 'The license server cannot be reached: {reason}',
  },
  'plugins.license.server.failed': {
    kind: 'unavailable',
    message: 'The license server answered unexpectedly (HTTP {status}).',
  },
} satisfies Record<PluginErrorKey, PluginErrorSpec>;

export type LicenseErrorKey = keyof typeof licenseErrors;

/** The error of a key, with its sentence as the detail's message. */
export function licenseError(key: LicenseErrorKey, params: Record<string, unknown> = {}) {
  const spec: PluginErrorSpec = licenseErrors[key];
  const detail: ErrorDetail = { key, params };
  return new ManabloxError(key, { kind: spec.kind ?? 'bad_request', details: [detail] });
}

/** A key's sentence with `{param}` filled in. */
export function licenseMessage(key: string, params: Record<string, unknown> = {}): string {
  const spec = (licenseErrors as Record<string, PluginErrorSpec>)[key];
  if (!spec) return key;
  return spec.message.replace(/\{(\w+)\}/g, (all, name: string) =>
    params[name] === undefined ? all : String(params[name]),
  );
}
