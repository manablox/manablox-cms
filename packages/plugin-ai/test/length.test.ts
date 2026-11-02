import { describe, expect, it } from 'vitest';
import { AI_DEFAULT_LENGTHS, resolveLength } from '../src/sdk.js';
import {
  boundedBlocks,
  composeDocumentPrompt,
  composeTextPrompt,
  fieldLengthPhrase,
} from '../src/server/prompt.js';
import { normaliseLengths, readSettings } from '../src/server/services/ai.service.js';

describe('lengths', () => {
  it('reads a preset as words for a field and words and blocks for a document', () => {
    expect(resolveLength('field', { length: 'long' }, AI_DEFAULT_LENGTHS)).toEqual({ words: 250 });
    expect(resolveLength('document', { length: 'long' }, AI_DEFAULT_LENGTHS)).toEqual({
      words: 1500,
      blocks: 8,
    });
    expect(resolveLength('document', {}, AI_DEFAULT_LENGTHS)).toBeNull();
  });

  it('lets exact numbers win over the preset', () => {
    expect(
      resolveLength('document', { length: 'short' }, AI_DEFAULT_LENGTHS, { words: 4000 }),
    ).toEqual({ words: 4000, blocks: 3 });
  });

  it('asks a field for a number of words, unless the field is too short for it', () => {
    expect(fieldLengthPhrase({ words: 100 })).toBe(
      'Write about 100 words - no fewer than 80 and no more than 120.',
    );
    expect(fieldLengthPhrase({ words: 100 }, 160)).toBe('');
    const prompt = composeTextPrompt(
      'A teaser',
      { length: 'short' },
      { maxLength: 60 },
      {
        words: 30,
      },
    );
    expect(prompt).toContain('Stay under 60 characters.');
    expect(prompt).not.toContain('Write about');
  });

  it('sizes a whole document and each block field, within what the field allows', () => {
    const prompt = composeDocumentPrompt({
      instruction: 'A guide to composting',
      typeLabel: 'Article',
      fields: [],
      length: { words: 2000, blocks: 9 },
      audience: 'first-time gardeners',
      keywords: ['compost', 'soil'],
      blockFields: [{ name: 'body', label: 'Body', single: false, max: 6, types: [], grid: false }],
    });
    expect(prompt).toContain('about 2000 words in total - at least 1700');
    expect(prompt).toContain('aim for 6 of them');
    expect(prompt).toContain('Write for this audience: first-time gardeners.');
    expect(prompt).toContain('compost, soil');
    expect(boundedBlocks(1, { min: 3 })).toBe(3);
  });

  it('keeps a space its presets, and falls back to the shipped ones', () => {
    expect(readSettings({}).lengths).toEqual(AI_DEFAULT_LENGTHS);
    const lengths = normaliseLengths([
      { id: 'tweet', label: ' Tweet ', fieldWords: 40.2, documentWords: 0, blocks: 0 },
    ]);
    expect(lengths).toEqual([
      { id: 'tweet', label: 'Tweet', fieldWords: 40, documentWords: 1, blocks: null },
    ]);
    expect(readSettings({ ai: { lengths } }).lengths).toEqual(lengths);
    expect(() =>
      normaliseLengths([
        { id: 'a', label: 'A', fieldWords: 1, documentWords: 1, blocks: null },
        { id: 'a', label: 'B', fieldWords: 1, documentWords: 1, blocks: null },
      ]),
    ).toThrow();
  });
});
