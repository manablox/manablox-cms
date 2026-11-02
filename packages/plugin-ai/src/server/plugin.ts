import { defineJob, definePlugin, type ManabloxPlugin, type PluginContext } from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import type {} from '@manablox/plugin-workflows/define';
import { z } from 'zod';
import { aiAudit } from './audit.js';
import { aiControls } from './controls.js';
import { aiProvidersData } from './data.js';
import * as tables from './db/tables.js';
import { aiErrors } from './errors.js';
import { AI } from './keys.js';
import { aiLlms } from './llms.js';
import { aiPermissions } from './permissions.js';
import { aiRpc } from './rpc.js';
import { type AiOptions, type AiServices, aiServices } from './services/index.js';
import { aiSpaceCreate } from './space-create.js';
import { aiGenerateAction } from './workflow-action.js';

export type AiPluginOptions = AiOptions;

/**
 * AI assistance: providers per space with encrypted keys, text, document, image and video
 * generation, designs of content types and templates, and a design service other plugins use.
 */
export function aiPlugin(options: AiPluginOptions = {}): ManabloxPlugin<AiServices> {
  const pkg = pluginPackage(import.meta.url);
  return definePlugin<AiServices>({
    name: AI,
    description: 'AI assistance: text, image and model generation with your own provider keys.',
    // Adds its step, field kinds and design hints to workflows when they are there.
    enhances: ['workflows'],
    db: {
      tables,
      migrations: pkg.migrations,
    },
    permissions: aiPermissions,
    controls: aiControls,
    audit: aiAudit,
    errors: aiErrors,
    services: aiServices(options),
    jobs: {
      // Image and video generations, polled by the admin.
      generate: defineJob(
        z.object({ generationId: z.string() }),
        async ({ generationId }, plugin: PluginContext<AiServices>) => {
          await plugin.services.ai.runGeneration(generationId);
        },
      ),
    },
    rpc: aiRpc,
    data: [aiProvidersData],
    contributions: {
      workflows: {
        actions: [aiGenerateAction],
        fieldKinds: [
          { kind: 'aiProvider', description: 'A provider of the space.' },
          { kind: 'aiModel', description: "A model of the action's provider." },
        ],
        designHints: [
          {
            section: 'placeholders',
            text: '- To write a whole document, use "ai.generate" with "capability": "document" and the document type in "typeId", then "content.create" with "from": "{{ nodes.<that step key> }}" - it takes the type, title and every field from it. Leave "model" empty unless the request names one.',
          },
        ],
      },
    },
    spaceCreate: aiSpaceCreate,
    admin: { dir: pkg.adminDir },
    llms: aiLlms,
  });
}
