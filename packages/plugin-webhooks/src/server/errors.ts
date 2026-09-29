import type { PluginErrorKey, PluginErrorSpec } from '@manablox/core';

/** The webhooks plugin's error keys and their English sentences. */
export const webhookErrors: Record<PluginErrorKey, PluginErrorSpec> = {
  'plugins.webhooks.notFound': { kind: 'not_found', message: 'That webhook no longer exists.' },
  'plugins.webhooks.validation.failed': {
    kind: 'validation',
    message: 'The webhook could not be saved - see the parts marked.',
  },
  'plugins.webhooks.create.failed': { kind: 'internal', message: 'The webhook was not stored.' },
  'plugins.webhooks.name.required': { message: 'A name is required.' },
  'plugins.webhooks.slug.invalid': {
    message: 'The name has to contain at least one letter or digit.',
  },
  'plugins.webhooks.slug.taken': {
    kind: 'conflict',
    message: 'Another webhook of this space already has that address.',
  },
  'plugins.webhooks.url.required': { message: 'An outgoing webhook needs a URL to call.' },
  'plugins.webhooks.url.invalid': { message: 'That is not an http or https URL.' },
  'plugins.webhooks.event.unknown': { message: 'The server does not know that event.' },
  'plugins.webhooks.method.unknown': { message: 'The server does not know that method.' },
  'plugins.webhooks.header.nameInvalid': { message: 'That is not a valid header name.' },
  'plugins.webhooks.auth.credentialRequired': {
    message: 'This way of authenticating needs a credential.',
  },
  'plugins.webhooks.auth.credentialKind': {
    message: 'That credential is the wrong kind for this way of authenticating.',
  },
  'plugins.webhooks.auth.modeUnsupported': {
    message: 'That way of authenticating cannot be used in this direction.',
  },
  'plugins.webhooks.auth.signatureHeaderInvalid': { message: 'That is not a valid header name.' },
  'plugins.webhooks.direction.mismatch': {
    message: 'A webhook cannot change direction - create a new one.',
  },
  'plugins.webhooks.delivery.notFound': {
    kind: 'not_found',
    message: 'That call is no longer in the log.',
  },
  'plugins.webhooks.delivery.requestFailed': { message: '{method} {url} failed: {reason}' },
  'plugins.webhooks.delivery.httpStatus': {
    message: '{method} {url} answered with HTTP {status}.',
  },
  'plugins.webhooks.delivery.notRetryable': {
    message: 'Only an outgoing call can be sent again.',
  },
  'plugins.webhooks.unauthorized': {
    kind: 'unauthorized',
    message: 'The call did not prove who it was.',
  },
  'plugins.webhooks.disabled': { message: 'The endpoint is switched off.' },
  'plugins.webhooks.methodNotAllowed': { message: 'The endpoint does not accept that method.' },
  'plugins.webhooks.payload.invalid': { message: 'The body could not be read.' },
  'plugins.webhooks.payload.tooLarge': {
    message: 'The body is larger than an incoming call may be.',
  },
  'plugins.webhooks.code.immutable': {
    kind: 'forbidden',
    message: 'This endpoint is declared in code and cannot be edited here.',
  },
  'plugins.webhooks.trigger.required': {
    message: 'Pick the incoming webhook this workflow starts from.',
  },
  'plugins.webhooks.trigger.notFound': {
    message: 'That incoming webhook no longer exists in this space.',
  },
  'plugins.webhooks.abort.required': { message: 'Pick the incoming webhook that aborts the run.' },
  'plugins.webhooks.abort.notFound': {
    message: 'That incoming webhook no longer exists in this space.',
  },
  'plugins.webhooks.code.url.required': {
    message: 'The outgoing webhook "{slug}" needs a URL.',
  },
  'plugins.webhooks.code.auth.modeUnsupported': {
    message: 'The {direction} webhook "{slug}" cannot authenticate with "{mode}".',
  },
  'plugins.webhooks.code.auth.credentialRequired': {
    message: 'The webhook "{slug}" authenticates with "{mode}" and needs a {kind} credential.',
  },
};
