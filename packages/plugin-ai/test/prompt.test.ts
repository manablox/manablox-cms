import type { FieldDefinition } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { composeDocumentPrompt, composeTextPrompt, parseFieldMap } from '../src/server/prompt.js';

const field = (name: string, type: string): FieldDefinition => ({
  id: name,
  name,
  label: name,
  type,
  settings: {},
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', position: 0, width: 100 },
});

describe('composeTextPrompt', () => {
  it('tells the model which field it is writing and what shape the value takes', () => {
    const prompt = composeTextPrompt(
      'a teaser for the spring range',
      { writingStyle: 'marketing', tone: 'playful' },
      { fieldLabel: 'Teaser', fieldType: 'string', maxLength: 160, locale: 'de' },
    );
    expect(prompt).toContain('"Teaser"');
    expect(prompt).toContain('plain text field');
    expect(prompt).toContain('under 160 characters');
    expect(prompt).toContain('"de"');
    expect(prompt).toContain('marketing copy');
    expect(prompt).toContain('playful');
    // The editor's instruction comes last.
    expect(prompt.trimEnd().endsWith('a teaser for the spring range')).toBe(true);
  });

  it('asks a rich text field for HTML, and carries the neighbours it should match', () => {
    const prompt = composeTextPrompt(
      'the body',
      {},
      { fieldType: 'richtext', fieldLabel: 'Body', siblings: { Teaser: 'Spring is here' } },
    );
    expect(prompt).toContain('simple HTML');
    expect(prompt).toContain('Spring is here');
  });

  it('leaves out what it was not told', () => {
    const prompt = composeTextPrompt('anything', null, {});
    expect(prompt).toBe('The request: anything');
  });
});

describe('composeDocumentPrompt', () => {
  it('lists every field it wants back and asks for one JSON object', () => {
    const prompt = composeDocumentPrompt({
      instruction: 'a page about the shop',
      styles: { tone: 'friendly' },
      typeLabel: 'Page',
      fields: [field('title', 'string'), field('body', 'richtext')],
      locale: 'en',
    });
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain('simple HTML');
    expect(prompt).toContain('single JSON object');
  });
});

describe('parseFieldMap', () => {
  it('reads a bare object', () => {
    expect(parseFieldMap('{"title":"Hello","body":"<p>Hi</p>"}')).toEqual({
      title: 'Hello',
      body: '<p>Hi</p>',
    });
  });

  it('reads one inside a fence or a sentence, which is how models answer', () => {
    expect(parseFieldMap('```json\n{"title":"Hello"}\n```')).toEqual({ title: 'Hello' });
    expect(parseFieldMap('Sure! {"title":"Hello"} Let me know.')).toEqual({ title: 'Hello' });
  });

  it('keeps only values a field could hold', () => {
    expect(parseFieldMap('{"title":"Hello","count":3,"nested":{"a":1}}')).toEqual({
      title: 'Hello',
      count: '3',
    });
  });

  it('says so when there is no object at all', () => {
    expect(parseFieldMap('I cannot help with that.')).toBeNull();
    expect(parseFieldMap('{not json}')).toBeNull();
  });
});
