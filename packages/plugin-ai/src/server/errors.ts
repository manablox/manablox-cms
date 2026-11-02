import type { PluginErrorKey, PluginErrorSpec } from '@manablox/core';

/** The AI plugin's error keys and their English sentences. */
export const aiErrors: Record<PluginErrorKey, PluginErrorSpec> = {
  'plugins.ai.provider.notFound': {
    kind: 'not_found',
    message: 'That provider is not set up in this space.',
  },
  'plugins.ai.provider.notConfigured': {
    message: 'No AI provider in this space can do that yet - add one under Settings, AI.',
  },
  'plugins.ai.provider.disabled': { message: 'That provider is switched off for this space.' },
  'plugins.ai.provider.kind.unknown': { message: 'This version does not know that provider.' },
  'plugins.ai.provider.kind.taken': {
    kind: 'conflict',
    message: 'That provider is already set up in this space.',
  },
  'plugins.ai.provider.apiKey.required': { message: 'That provider has no API key stored yet.' },
  'plugins.ai.provider.capability.unsupported': {
    message: 'That provider cannot generate that kind of thing.',
  },
  'plugins.ai.provider.model.notOffered': {
    message: 'That provider does not offer that model for this job.',
  },
  'plugins.ai.provider.model.notFound': {
    message: 'This key cannot see the model chosen here - pick another one on the card.',
  },
  'plugins.ai.provider.unreachable': { message: 'The provider could not be reached.' },
  'plugins.ai.request.failed': { message: 'The provider refused the request.' },
  'plugins.ai.response.empty': { message: 'The provider returned nothing.' },
  'plugins.ai.response.filtered': {
    message: 'The provider withheld the answer under its content policy. Rephrase the prompt.',
  },
  'plugins.ai.response.truncated': {
    message: 'The answer hit the output limit and was cut off. Ask for less or raise the limit.',
  },
  'plugins.ai.response.unusable': {
    message: 'The provider answered with something that could not be used.',
  },
  'plugins.ai.prompt.required': { message: 'Say what to generate.' },
  'plugins.ai.generation.notFound': {
    kind: 'not_found',
    message: 'That generation no longer exists.',
  },
  'plugins.ai.generation.failed': { message: 'The generation failed.' },
  'plugins.ai.generation.notReady': {
    message: 'The provider is still working - it took longer than allowed.',
  },
  'plugins.ai.generation.noAsset': { message: 'The generation produced no file.' },
  'plugins.ai.document.type.notFound': {
    kind: 'not_found',
    message: 'That content type no longer exists.',
  },
  'plugins.ai.document.type.noTextFields': {
    message: 'This content type has no text fields to write.',
  },
  'plugins.ai.provider.custom.slugInvalid': {
    message: 'Use lower-case letters, digits and hyphens, starting with a letter or digit.',
  },
  'plugins.ai.provider.custom.baseUrlInvalid': {
    message: 'The base URL has to be an http or https address.',
  },
  'plugins.ai.provider.custom.hostNotAllowed': {
    message:
      "That server is on the private network. An administrator has to add it to the instance's allowed AI hosts (the plugin's allowedHosts option, usually set with AI_ALLOWED_HOSTS) and restart the instance.",
  },
  'plugins.ai.settings.lengths.invalid': {
    message: 'Every length needs its own name and a number of words.',
  },
  'plugins.ai.design.empty': {
    message: 'The model did not design anything usable. Describe it again, more precisely.',
  },
  'plugins.ai.workflow.promptRequired': { message: 'Say what the model should write.' },
  'plugins.ai.workflow.promptEmpty': {
    message: 'The prompt came out empty once its placeholders were filled.',
  },
  'plugins.ai.workflow.pictureFailed': { message: 'The picture could not be drawn: {reason}' },
  'plugins.ai.workflow.pictureTimeout': {
    message: 'The picture was not ready after {seconds} seconds.',
  },
  'plugins.ai.workflow.typeGone': { message: 'The type of document to write no longer exists.' },
  'plugins.ai.workflow.notJson': { message: 'The model did not answer with JSON: {excerpt}' },
};
