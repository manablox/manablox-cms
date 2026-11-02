import { isMachineName, ManabloxError } from '@manablox/core';
import { AI_DEFAULT_LENGTHS, AI_LENGTH_LIMITS, type AiLengthPreset } from '../../../sdk.js';
import type { AiSpaceSettings } from './types.js';

/** Reads AI settings from space settings, falling back to defaults. */
export function readSettings(
  settings: Record<string, unknown> | null | undefined,
): AiSpaceSettings {
  const stored = asRecord(asRecord(settings).ai).lengths;
  if (!Array.isArray(stored) || !stored.length) return { lengths: [...AI_DEFAULT_LENGTHS] };
  try {
    return { lengths: normaliseLengths(stored as AiLengthPreset[]) };
  } catch {
    return { lengths: [...AI_DEFAULT_LENGTHS] };
  }
}

/** Space settings with the AI length presets replaced. */
export function withLengths(
  settings: Record<string, unknown>,
  lengths: AiLengthPreset[],
): Record<string, unknown> {
  return { ...settings, ai: { ...asRecord(settings.ai), lengths } };
}

/** Validates and clamps presets; ids must be unique. */
export function normaliseLengths(input: readonly AiLengthPreset[]): AiLengthPreset[] {
  if (!input.length || input.length > AI_LENGTH_LIMITS.presets) {
    throw ManabloxError.badRequest('plugins.ai.settings.lengths.invalid', {
      reason: 'count',
      max: AI_LENGTH_LIMITS.presets,
    });
  }
  const seen = new Set<string>();
  return input.map((preset) => {
    const id = String(preset.id ?? '').trim();
    if (!isMachineName(id) || seen.has(id)) {
      throw ManabloxError.badRequest('plugins.ai.settings.lengths.invalid', { reason: 'id', id });
    }
    seen.add(id);
    const words = (value: unknown) =>
      Math.min(Math.max(Math.round(Number(value) || 0), 1), AI_LENGTH_LIMITS.words);
    const blocks =
      preset.blocks === null || preset.blocks === undefined || Number(preset.blocks) <= 0
        ? null
        : Math.min(Math.round(Number(preset.blocks)), AI_LENGTH_LIMITS.blocks);
    return {
      id,
      label:
        String(preset.label ?? '')
          .trim()
          .slice(0, 60) || id,
      fieldWords: words(preset.fieldWords),
      documentWords: words(preset.documentWords),
      blocks,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
