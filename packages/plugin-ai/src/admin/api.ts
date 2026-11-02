import { defineAsyncComponent } from 'vue';
import type { AiAdminApi } from './admin-api';
import { fieldToText } from './model/context';
import {
  AI_DESIGN_MODELS,
  AI_DESIGN_SPACE,
  AI_FEATURE,
  AI_IMAGES,
  AI_VIDEO,
} from './model/features';
import { useDesignRun } from './useDesignRun';
import { useWand } from './useWand';

/** Components load on first use, so the entry stays small. */
export const aiAdminApi: AiAdminApi = {
  DesignDialog: defineAsyncComponent(() => import('./components/DesignDialog.vue')),
  useDesignRun,
  Sparkles: defineAsyncComponent(() => import('./components/AiSparkles.vue')),
  ProviderSelect: defineAsyncComponent(() => import('./components/AiProviderSelect.vue')),
  WandButton: defineAsyncComponent(() => import('./components/AiWandButton.vue')),
  useWand,
  fieldToText,
  features: {
    ai: AI_FEATURE,
    images: AI_IMAGES,
    video: AI_VIDEO,
    designModels: AI_DESIGN_MODELS,
    designSpace: AI_DESIGN_SPACE,
  },
};
