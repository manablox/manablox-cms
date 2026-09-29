import type { CredentialSecret } from '@manablox/core';
import { sameSignature, signBody } from '@manablox/core/node';
import { credentialHeaders } from '@manablox/services';
import type { WebhookRow } from '../../db/index.js';
import { credentialFor, type WebhookContext } from './context.js';
import type { IncomingCall } from './types.js';

/** Adds the endpoint's authentication to an outgoing delivery's headers. */
export async function applyAuth(
  ctx: WebhookContext,
  webhook: WebhookRow,
  headers: Record<string, string>,
  body: string,
): Promise<void> {
  if (webhook.authMode === 'none') return;

  const credential = await credentialFor(ctx, webhook);
  if (webhook.authMode === 'hmac') {
    headers[webhook.signatureHeader.toLowerCase()] = signatureOf(webhook, credential, body);
    return;
  }
  Object.assign(headers, await credentialHeaders(credential, ctx.fetch));
}

/** Verifies an incoming call with constant-time comparisons. */
export async function verify(
  ctx: WebhookContext,
  webhook: WebhookRow,
  call: IncomingCall,
): Promise<boolean> {
  if (webhook.authMode === 'none') return true;

  let credential: CredentialSecret;
  try {
    credential = await credentialFor(ctx, webhook);
  } catch (err) {
    // A missing credential fails closed.
    ctx.manablox.logger.warn(
      { err, webhookId: webhook.id, spaceId: webhook.spaceId },
      'incoming webhook credential unavailable',
    );
    return false;
  }

  switch (webhook.authMode) {
    case 'hmac': {
      const sent = call.headers[webhook.signatureHeader.toLowerCase()];
      if (!sent) return false;
      const expected = signatureOf(webhook, credential, call.raw);
      // Accept both bare and prefixed digests; services disagree.
      const bare =
        webhook.signatureFormat === 'prefixed'
          ? expected.slice(expected.indexOf('=') + 1)
          : expected;
      return sameSignature(sent, expected) || sameSignature(sent, bare);
    }
    case 'token':
    case 'basic':
    case 'bearer': {
      // Incoming calls never exchange tokens, so the fetch is never used.
      const expected = Object.entries(await credentialHeaders(credential, ctx.fetch));
      return (
        expected.length > 0 &&
        expected.every(([name, value]) => sameSignature(call.headers[name] ?? '', value))
      );
    }
    default:
      return false;
  }
}

function signatureOf(webhook: WebhookRow, credential: CredentialSecret, body: string): string {
  return signBody(credential.data.secret ?? '', body, {
    algorithm: webhook.algorithm,
    format: webhook.signatureFormat,
  });
}
