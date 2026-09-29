import { ManabloxClient, type ManabloxClientOptions } from './client.js';

export interface PreviewClientOptions extends ManabloxClientOptions {
  /** An API key with read access, required to read drafts. */
  apiKey: string;
}

/**
 * A preview-mode client for a management instance. It carries an API key, so import it
 * from server code only.
 */
export function createPreviewClient(options: PreviewClientOptions): ManabloxClient {
  const { apiKey, ...rest } = options;

  return new ManabloxClient({
    ...rest,
    // Never cache drafts.
    cache: false,
    headers: {
      ...rest.headers,
      'x-api-key': apiKey,
      'x-manablox-preview': '1',
    },
    // REST is only served by public instances, which have no drafts.
    transport: 'graphql',
  });
}

export { ManabloxClient } from './client.js';
export * from './errors.js';
export * from './types.js';
