import { ManabloxError } from '@manablox/core';
import type { AiCapability, AiProviderKind } from '../../sdk.js';
import { anthropicProvider } from './anthropic.js';
import { customProvider } from './custom.js';
import { googleProvider } from './google.js';
import { openaiProvider } from './openai.js';
import type { AiProviderClient, MediaResult, ProviderCall, TextResult } from './types.js';

export { withoutThinking } from './custom.js';
export * from './types.js';

/** Kind -> client. */
export const PROVIDER_CLIENTS: Record<AiProviderKind, AiProviderClient> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  custom: customProvider,
};

export function providerClient(kind: AiProviderKind): AiProviderClient {
  const client = PROVIDER_CLIENTS[kind];
  if (!client) throw ManabloxError.badRequest('plugins.ai.provider.kind.unknown', { kind });
  return client;
}

/** Throws unless the provider serves this capability. */
export function assertCapability(client: AiProviderClient, capability: AiCapability): void {
  if (!client.capabilities.includes(capability)) {
    throw ManabloxError.badRequest('plugins.ai.provider.capability.unsupported', {
      provider: client.kind,
      capability,
    });
  }
}

/** The method serving a capability; throws like `assertCapability` if missing. */
export function capabilityOf(
  kind: AiProviderKind,
  capability: 'text',
): (call: ProviderCall) => Promise<TextResult>;
export function capabilityOf(
  kind: AiProviderKind,
  capability: 'image' | 'video',
): (call: ProviderCall) => Promise<MediaResult>;
export function capabilityOf(
  kind: AiProviderKind,
  capability: AiCapability,
): (call: ProviderCall) => Promise<TextResult | MediaResult> {
  const client = providerClient(kind);
  assertCapability(client, capability);
  const method =
    capability === 'text'
      ? client.generateText
      : capability === 'image'
        ? client.generateImage
        : client.generateVideo;
  if (!method) {
    throw ManabloxError.badRequest('plugins.ai.provider.capability.unsupported', {
      provider: kind,
      capability,
    });
  }
  return method.bind(client);
}
