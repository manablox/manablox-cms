import { ManabloxError } from '@manablox/core';
import {
  AI_CUSTOM_APIS,
  AI_CUSTOM_DEFAULTS,
  AI_PROVIDERS,
  type AiCapability,
  type AiCustomConfig,
} from '../../../sdk.js';
import type { AiProviderRow } from '../../db/index.js';

/** Self-hosted config with defaults filled and values clamped; rows may lack newer fields. */
export function normaliseCustomConfig(
  input: Partial<AiCustomConfig> | null | undefined,
): AiCustomConfig {
  const raw = input ?? {};
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim().replace(/\/+$/, '') : '';
  if (baseUrl && !/^https?:\/\/[^\s/]+/i.test(baseUrl)) {
    throw ManabloxError.badRequest('plugins.ai.provider.custom.baseUrlInvalid', { baseUrl });
  }
  const capabilities = (
    Array.isArray(raw.capabilities) ? raw.capabilities : AI_CUSTOM_DEFAULTS.capabilities
  ).filter(
    (capability): capability is AiCapability => capability === 'text' || capability === 'image',
  );
  const positive = (value: unknown, max: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.min(Math.round(value), max)
      : undefined;
  const maxOutputTokens = positive(raw.maxOutputTokens, 1_000_000);
  const contextWindow = positive(raw.contextWindow, 10_000_000);
  const timeoutSeconds = positive(raw.timeoutSeconds, 3600) ?? AI_CUSTOM_DEFAULTS.timeoutSeconds;
  return {
    baseUrl,
    api: AI_CUSTOM_APIS.includes(raw.api as never) ? (raw.api as AiCustomConfig['api']) : 'openai',
    capabilities: [...new Set(capabilities)],
    json: raw.json ?? AI_CUSTOM_DEFAULTS.json,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
  };
}

/** A provider's capabilities; a self-hosted one is limited to what it declares. */
export function capabilitiesOf(row: Pick<AiProviderRow, 'kind' | 'config'>): AiCapability[] {
  const offered = AI_PROVIDERS[row.kind]?.capabilities ?? [];
  if (row.kind !== 'custom') return [...offered];
  const declared = normaliseCustomConfig(row.config).capabilities;
  return offered.filter((capability) => declared.includes(capability));
}

/** Enabled, with a key (or a base URL when self-hosted). */
export function isUsable(row: AiProviderRow): boolean {
  if (!row.enabled) return false;
  if (row.kind === 'custom') return Boolean(normaliseCustomConfig(row.config).baseUrl);
  return Boolean(row.apiKey);
}

/** Rewrites a blocked private-network error for a self-hosted provider into actionable advice. */
export function explainBlocked(error: unknown, row: AiProviderRow): unknown {
  if (!ManabloxError.is(error) || error.key !== 'net.blocked' || row.kind !== 'custom') {
    return error;
  }
  const baseUrl = normaliseCustomConfig(row.config).baseUrl;
  // A base URL that does not parse is named as it was typed.
  const host = URL.parse(baseUrl)?.host ?? baseUrl;
  return ManabloxError.badRequest('plugins.ai.provider.custom.hostNotAllowed', {
    host,
    message: `${host} is on the private network. To reach it, add "${host}" to the instance's allowed AI hosts (the ai.allowedHosts config option, usually set with AI_ALLOWED_HOSTS) and restart the instance.`,
  });
}
