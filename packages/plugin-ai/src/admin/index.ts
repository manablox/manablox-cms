import { defineAdminPlugin } from '@manablox/admin-plugin';
import { useSessionStore, useSpaceStore } from '@manablox/admin-sdk';
import type {} from '@manablox/plugin-workflows/admin-slots';
import { AI_ASSET_FIELD_TYPES, AI_TEXT_FIELD_TYPES } from '../sdk';
import { aiAdminApi } from './api';
import { invalidateAi } from './keys';
import { AI_DESIGN_MODELS, AI_DESIGN_SPACE } from './model/features';
import {
  spaceDesignCreated,
  spaceDesignData,
  spaceDesignPlan,
  validateSpaceDesign,
} from './model/space-starter';
import './style.css';

export type * from './admin-api';

/** Where the providers and settings are. */
const SETTINGS = '/settings?tab=ai.ai';

const PROVIDER_ENTITY = { label: 'AI provider', route: () => SETTINGS };
const GENERATION_ENTITY = { label: 'AI generation', route: () => SETTINGS };

/** Asset fields that store picks; a filter field has nothing to add to. */
const takesAssets = (settings: Record<string, unknown>): boolean =>
  !(settings.multiple === true && settings.selection === 'filter');

/**
 * AI assistance through the admin's slots: wands, generation, designs and the providers tab.
 * Entries marked `locked` draw a lock while AI is locked in the space.
 */
export default defineAdminPlugin({
  name: 'ai',
  slots: {
    'field.actions': [
      {
        key: 'wand',
        locked: true,
        when: ({ field, context }) =>
          !context.readOnly &&
          (AI_TEXT_FIELD_TYPES.includes(field.type) ||
            (AI_ASSET_FIELD_TYPES.includes(field.type) && takesAssets(field.settings))),
        component: () => import('./slots/FieldWand.vue'),
      },
    ],
    'assets.actions': [
      {
        key: 'generate',
        permission: 'asset:write',
        locked: true,
        component: () => import('./slots/AssetWands.vue'),
      },
    ],
    'content.editor.actions': [
      { key: 'generate', locked: true, component: () => import('./slots/DocumentGenerate.vue') },
    ],
    'contentType.list.actions': [
      {
        key: 'describe',
        permission: 'contentType:write',
        locked: true,
        component: () => import('./slots/TypeDesignAction.vue'),
      },
    ],
    'template.list.actions': [
      {
        key: 'describe',
        locked: true,
        component: () => import('./slots/TemplateDesignAction.vue'),
      },
    ],
    'space.create.starters': [
      {
        key: 'describe',
        feature: AI_DESIGN_SPACE,
        starter: {
          title: 'Describe it',
          hint: 'Say what the site holds; AI designs the types it needs.',
        },
        // Designs run through a space whose AI the creator may use.
        when: () => {
          const session = useSessionStore();
          return useSpaceStore().spaces.some((space) => session.can('ai:use', space.id));
        },
        validate: validateSpaceDesign,
        plan: spaceDesignPlan,
        data: spaceDesignData,
        created: spaceDesignCreated,
        component: () => import('./slots/SpaceDesignStarter.vue'),
      },
    ],
    // The AI step's forms, drawn whether or not AI is on in the space.
    'workflows:fieldControl': [
      {
        key: 'provider',
        kind: 'aiProvider',
        feature: null,
        component: () => import('./slots/WorkflowModelField.vue'),
      },
      {
        key: 'model',
        kind: 'aiModel',
        feature: null,
        component: () => import('./slots/WorkflowModelField.vue'),
      },
    ],
    'workflows:createActions': [
      {
        key: 'describe',
        label: 'Describe it',
        icon: 'wand',
        feature: AI_DESIGN_MODELS,
        permission: 'ai:use',
        component: () => import('./slots/WorkflowDesignAction.vue'),
      },
    ],
  },
  settingsSections: [
    {
      id: 'ai',
      label: 'AI',
      icon: 'wand',
      scope: 'space',
      component: () => import('./components/AiSettings.vue'),
    },
  ],
  transferSections: [
    {
      kind: 'ai.providers',
      group: 'integrations',
      icon: 'sparkles',
      label: 'AI providers',
      description:
        'Models, system prompt and defaults. The API key stays behind, so a provider arrives switched off.',
      noun: ['AI provider', 'AI providers'],
      pickable: true,
    },
  ],
  realtime: {
    'ai.provider': (event) => invalidateAi(event.spaceId),
    'ai.settings': (event) => invalidateAi(event.spaceId),
    'ai.generation': (event) => invalidateAi(event.spaceId),
  },
  audit: {
    entities: {
      'ai.provider': PROVIDER_ENTITY,
      'ai.generation': GENERATION_ENTITY,
      'ai.settings': { label: 'AI settings', route: () => SETTINGS },
    },
    actions: {
      'ai.provider.configure': 'Configured an AI provider',
      'ai.provider.delete': 'Removed an AI provider',
      'ai.generation.create': 'Generated content with AI',
      'ai.settings.update': 'Changed the AI settings',
    },
    verbs: {
      'ai.provider.configure': 'Configured',
      'ai.provider.delete': 'Removed',
      'ai.generation.create': 'Generated',
      'ai.settings.update': 'Edited',
    },
  },
  features: {
    'plugins.ai': 'AI generation',
    'plugins.ai.images': 'AI images',
    'plugins.ai.video': 'AI video',
    'plugins.ai.designModels': 'Designing with AI',
    'plugins.ai.designSpace': 'Designing a space with AI',
    'plugins.ai.workflows': 'The AI workflow step',
  },
  permissionIcons: { 'plugins.ai': 'wand' },
  usage: {
    'plugins.ai.calls': { label: 'AI calls', blocked: 'AI generation is unavailable.' },
  },
  setup({ expose }) {
    expose(aiAdminApi);
  },
});
