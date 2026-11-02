import type { PluginLlmsContext } from '@manablox/core';

/** The AI plugin's section of the LLM guide: designing and writing with the space's providers. */
export function aiLlms(_context: PluginLlmsContext): string {
  return [
    "### Let Manablox's own AI do the designing and writing",
    '',
    'When the space has an AI provider (Settings > AI), these procedures design from a description and write nothing; apply the result with the procedure named:',
    '',
    '- `plugins.ai.designContentTypes` `{spaceId, prompt, scope: "any" | "content" | "block"}` returns `{plan, notes, problems}`; apply `plan.types` with `contentTypes.applyPlan`.',
    "- `plugins.ai.designTemplate` `{spaceId, prompt}` returns block types to add (`plan`) and the template's `blocks`; apply the plan, then `content.create` the template.",
    '- `plugins.ai.generateDocument` `{spaceId, contentTypeId, prompt, locale, styles, length: {words, blocks}}` writes every field of a document and its blocks; save the result with `content.create`.',
    '- `plugins.ai.generateMedia` `{spaceId, prompt, capability: "image" | "video"}` starts a picture or a video; poll `plugins.ai.generation` `{spaceId, id}` until it settles, then use its `assetId` in an asset field.',
  ].join('\n');
}
