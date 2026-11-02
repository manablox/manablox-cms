import type { AiCapability, AiCustomConfig, AiProviderKind } from '../../sdk.js';

/** A resolved provider request. */
export interface ProviderCall {
  apiKey: string;
  model: string;
  /** Merged system prompt. */
  system: string;
  /** Prompt with styles applied. */
  prompt: string;
  /** Capability options, e.g. `aspectRatio`, `duration`. */
  options: Record<string, string | undefined>;
  /** Request JSON output where supported; answers are parsed leniently anyway. */
  json?: boolean | undefined;
  /** Output token ceiling, when above the default. */
  maxTokens?: number | undefined;
  /** Request timeout override. */
  timeoutMs?: number | undefined;
  /** Self-hosted config; absent for a hosted provider. */
  custom?: AiCustomConfig | undefined;
  signal?: AbortSignal | undefined;
  /** The host's guarded `fetch`, which refuses private-network addresses. */
  fetch?: typeof fetch | undefined;
}

export interface TextResult {
  text: string;
}

/** Generated media bytes. */
export interface MediaResult {
  body: Buffer;
  mimeType: string;
  /** Without extension. */
  filename: string;
}

export interface AiProviderClient {
  kind: AiProviderKind;
  capabilities: readonly AiCapability[];
  generateText?(call: ProviderCall): Promise<TextResult>;
  generateImage?(call: ProviderCall): Promise<MediaResult>;
  generateVideo?(call: ProviderCall): Promise<MediaResult>;
  /** A cheap call that checks the key and model. */
  verify(
    call: Pick<ProviderCall, 'apiKey' | 'model' | 'signal' | 'fetch' | 'custom' | 'timeoutMs'>,
  ): Promise<void>;
}
