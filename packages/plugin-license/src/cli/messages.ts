import { ManabloxError } from '@manablox/core';
import { licenseMessage } from '../server/errors.js';

/** Where the CLI points people: the license server and the portal. */
export interface Places {
  server: string;
  portal: string;
}

/** What to do about an error, by key; after its sentence. */
const HINTS: Record<string, (places: Places) => string> = {
  'plugins.license.key.malformed': () => 'Check for a typo; the portal shows the key to copy.',
  'plugins.license.key.invalid': ({ portal }) =>
    `Copy the key again from the portal: ${portal}/subscriptions`,
  'plugins.license.key.revoked': ({ portal }) =>
    `The portal shows the key that replaced it: ${portal}/subscriptions`,
  'plugins.license.key.noSeats': ({ portal }) =>
    `Deactivate an instance in the portal (${portal}/subscriptions) or add a seat there.`,
  'plugins.license.key.trialUsed': () =>
    'Buy a subscription instead: manablox license buy (without a trial).',
  'plugins.license.key.bound': () => 'Platform keys stay on the instance they were made for.',
  'plugins.license.subscription.inactive': ({ portal }) =>
    `Renew or pay the subscription in the portal: ${portal}/subscriptions`,
  'plugins.license.activation.conflict': () =>
    'Run manablox license activate on the instance that should keep the license.',
  'plugins.license.activation.kindMismatch': () =>
    'Run manablox license activate --production, which takes a seat.',
  'plugins.license.activation.notFound': () =>
    'Run manablox license activate to activate it again.',
  'plugins.license.cliSession.notFound': () => 'Start again: manablox license buy',
  'plugins.license.network': ({ server }) =>
    `Check the connection and MANABLOX_LICENSE_SERVER (now ${server}).`,
  'plugins.license.server.failed': ({ server }) =>
    `Try again later; the server is ${server} (MANABLOX_LICENSE_SERVER).`,
};

/** A license error's sentence and what to do about it, one line each. */
export function describeKeyError(key: string, message: string, places: Places): string {
  const hint = HINTS[key]?.(places);
  return hint ? `${message}\n  ${hint}` : message;
}

/** Any error as the CLI prints it: a license error by its key, anything else by its message. */
export function describeError(error: unknown, places: Places): string {
  if (ManabloxError.is(error) && error.key.startsWith('plugins.license.')) {
    const params = error.details[0]?.params ?? {};
    return describeKeyError(error.key, licenseMessage(error.key, params), places);
  }
  return error instanceof Error ? error.message : String(error);
}
