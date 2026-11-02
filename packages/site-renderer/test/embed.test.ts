import { describe, expect, it } from 'vitest';
import { embedFor } from '../src/embed.js';

describe('embedFor', () => {
  it('rebuilds frame sources from provider ids', () => {
    expect(embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(embedFor('https://youtube.com/shorts/abc123')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/abc123',
    );
    expect(embedFor('https://player.vimeo.com/video/123')?.src).toBe(
      'https://player.vimeo.com/video/123?dnt=1',
    );
    expect(embedFor('https://vimeo.com/123/abcdef')?.src).toBe(
      'https://player.vimeo.com/video/123?dnt=1&h=abcdef',
    );
    expect(embedFor('https://www.google.com/maps/embed?pb=!1m18!2d16.3')?.src).toBe(
      'https://www.google.com/maps/embed?pb=!1m18!2d16.3',
    );
    expect(embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')?.src).toBe(
      'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
    );
    expect(embedFor('https://soundcloud.com/artist/song')?.src).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsong',
    );
  });

  it('refuses other hosts, plain http, look-alike hosts and bad ids', () => {
    for (const url of [
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v="><script>',
      'https://evil.test/maps/embed?pb=1',
      'https://www.google.com/maps/embed?pb=<x>',
      'javascript:alert(1)',
      42,
    ])
      expect(embedFor(url)).toBeNull();
    expect(embedFor('https://youtu.be/dQw4w9WgXcQ', 'vimeo')).toBeNull();
  });
});
