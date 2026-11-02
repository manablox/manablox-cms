import type { PluginSpaceCreate } from '@manablox/core';
import { z } from 'zod';
import type { AiServices } from './services/index.js';

/** `plugins: { ai: { copyFrom } }` of `spaces.create`: the space whose providers to copy. */
const aiSpaceSchema = z.object({ copyFrom: z.string().uuid() });

type AiSpaceData = z.infer<typeof aiSpaceSchema>;

/**
 * Gives the new space another space's providers, keys included, once it exists. Creating a
 * space needs a superadmin, who may configure AI everywhere.
 */
export const aiSpaceCreate: PluginSpaceCreate<AiServices, AiSpaceData> = {
  schema: aiSpaceSchema,
  async afterCommit({ plugin, space }, { copyFrom }) {
    if (copyFrom === space.id) return null;
    if (!(await plugin.repos.spaces.findById(copyFrom))) {
      return 'The AI providers could not be copied: that space no longer exists.';
    }
    await plugin.services.ai.copyProviders(copyFrom, space.id);
    return null;
  },
};
