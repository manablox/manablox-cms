import type { PluginErrorKey } from './error-keys.js';
import { pluginErrorSpec } from './error-keys.js';
import { ManabloxError } from './errors.js';

/** An error with a declared plugin key, of the kind the plugin declared. */
export function pluginError(key: PluginErrorKey, params?: Record<string, unknown>): ManabloxError {
  const spec = pluginErrorSpec(key);
  if (!spec) throw new Error(`Undeclared plugin error key: ${key}`);
  return new ManabloxError(key, {
    kind: spec.kind ?? 'bad_request',
    details: [{ key, ...(params ? { params } : {}) }],
  });
}
