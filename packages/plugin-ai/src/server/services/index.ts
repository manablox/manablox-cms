import type { PluginServicesContext } from '@manablox/core';
import { configuredSafeFetch } from '@manablox/core/node';
import type {} from '@manablox/server';
import { AiService } from './ai.service.js';
import { AiDesignService } from './design.service.js';

declare module '@manablox/core' {
  /** Other plugins reach the AI services with `plugins.get('ai')`. */
  interface PluginServicesMap {
    ai: AiServices;
  }
}

/** How the plugin reaches providers and how hard designs are retried. */
export interface AiOptions {
  /**
   * Hosts a self-hosted model may be reached at although they are on the private network,
   * as `host` or `host:port`, e.g. `['ollama', 'localhost:11434']`. Usually from
   * `AI_ALLOWED_HOSTS`.
   */
  allowedHosts?: string[] | undefined;
  /** How often a design with problems is sent back to the model; 2 by default. */
  designRetries?: number | undefined;
}

/** The plugin's services: generation and providers, and designs; others reach them with `plugins.get('ai')`. */
export interface AiServices {
  ai: AiService;
  design: AiDesignService;
}

/** Builds the services once per process. */
export function aiServices(options: AiOptions) {
  return (context: PluginServicesContext): AiServices => {
    const { manablox, repos, plugin } = context;
    const { core } = plugin;
    // Keys are encrypted with the instance secret; media generation runs on the queue, or
    // without one within the request, which then answers with the result.
    const ai = new AiService(manablox, repos, core.media, {
      secret: manablox.config.auth.secret,
      ...(plugin.jobs.inline
        ? {}
        : {
            enqueue: (generationId: string, spaceId: string) =>
              plugin.jobs.enqueue('generate', { generationId, spaceId }),
          }),
      // The egress guard with the asset size limit; only allowed hosts bypass the private-network check.
      fetch: configuredSafeFetch(manablox.config.net, {
        maxResponseBytes: manablox.config.storage.maxFileSize ?? 256 * 1024 * 1024,
        allowHosts: options.allowedHosts ?? [],
      }),
      designRetries: options.designRetries ?? 2,
    });
    return { ai, design: new AiDesignService(manablox, ai) };
  };
}
