/**
 * The plugin's feature keys as the admin checks them; typed by the server's declaration, so a
 * key that is not declared there fails to compile.
 */
import type { aiKeys } from '../../server/keys';

type Keys = typeof aiKeys;

/** The plugin's own flag: AI at all. */
export const AI_FEATURE: Keys['feature'] = 'plugins.ai';
export const AI_IMAGES: Keys['features']['images'] = 'plugins.ai.images';
export const AI_VIDEO: Keys['features']['video'] = 'plugins.ai.video';
/** Designing types, templates, workflows and themes. */
export const AI_DESIGN_MODELS: Keys['features']['designModels'] = 'plugins.ai.designModels';
/** Designing a new space; read at the instance. */
export const AI_DESIGN_SPACE: Keys['features']['designSpace'] = 'plugins.ai.designSpace';
