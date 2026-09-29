import { describe, expect, it } from 'vitest';
import { isIdentifier, pascalName } from '../src/names.js';

describe('pascalName', () => {
  it('splits on any non-alphanumeric run', () => {
    expect(pascalName('blog_post')).toBe('BlogPost');
    expect(pascalName('hero-image')).toBe('HeroImage');
    expect(pascalName('hero.banner', 'Block')).toBe('BlockHeroBanner');
    expect(pascalName('heroBanner')).toBe('HeroBanner');
  });

  it('fixes a leading digit and an empty name', () => {
    expect(pascalName('2col')).toBe('T2col');
    expect(pascalName('2col', 'Block')).toBe('Block2col');
    expect(pascalName('--')).toBe('Type');
    expect(pascalName('', 'Block')).toBe('Block');
  });
});

describe('isIdentifier', () => {
  it('accepts bare identifiers only', () => {
    expect(isIdentifier('headline')).toBe(true);
    expect(isIdentifier('$_a1')).toBe(true);
    expect(isIdentifier('hero-image')).toBe(false);
    expect(isIdentifier('1st')).toBe(false);
    expect(isIdentifier('')).toBe(false);
  });
});
