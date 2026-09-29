import { describe, expect, it } from 'vitest';
import { absoluteMediaUrl } from '../src/urls.js';

describe('absoluteMediaUrl', () => {
  it('prefixes a root-relative path with the public origin', () => {
    expect(absoluteMediaUrl('/media/a1/original', 'https://cms.example.com')).toBe(
      'https://cms.example.com/media/a1/original',
    );
  });

  it('does not double a trailing slash on the base', () => {
    expect(absoluteMediaUrl('/media/a1/original', 'https://cms.example.com/')).toBe(
      'https://cms.example.com/media/a1/original',
    );
  });

  it('leaves an absolute URL alone, so an S3 or CDN URL survives', () => {
    const cdn = 'https://cdn.example.com/uploads/a1.jpg';
    expect(absoluteMediaUrl(cdn, 'https://cms.example.com')).toBe(cdn);
    expect(absoluteMediaUrl('//cdn.example.com/a1.jpg', 'https://cms.example.com')).toBe(
      '//cdn.example.com/a1.jpg',
    );
  });

  it('leaves the URL alone when no public origin is configured', () => {
    expect(absoluteMediaUrl('/media/a1/original', undefined)).toBe('/media/a1/original');
  });

  it('preserves a signed transform query', () => {
    expect(absoluteMediaUrl('/media/a1/card.webp?s=abc', 'https://cms.example.com')).toBe(
      'https://cms.example.com/media/a1/card.webp?s=abc',
    );
  });
});
