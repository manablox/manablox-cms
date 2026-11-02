import type { EMBED_PROVIDERS } from '@manablox/site';

export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export interface Embed {
  provider: EmbedProvider;
  src: string;
  /** Feature policy for the frame. */
  allow: string;
}

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function youtube(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (!id || !ID.test(id)) return null;
  const start = Number.parseInt(
    url.searchParams.get('t') ?? url.searchParams.get('start') ?? '',
    10,
  );
  const query = Number.isFinite(start) && start > 0 ? `?start=${start}` : '';
  return `https://www.youtube-nocookie.com/embed/${id}${query}`;
}

function vimeo(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  const match =
    host === 'vimeo.com'
      ? /^\/(\d{1,20})(?:\/([a-f0-9]{1,20}))?\/?$/.exec(url.pathname)
      : host === 'player.vimeo.com'
        ? /^\/video\/(\d{1,20})\/?$/.exec(url.pathname)
        : null;
  if (!match) return null;
  const hash = match[2] ?? url.searchParams.get('h');
  const params = new URLSearchParams({ dnt: '1' });
  if (hash && /^[a-f0-9]{1,20}$/.test(hash)) params.set('h', hash);
  return `https://player.vimeo.com/video/${match[1]}?${params}`;
}

function googleMaps(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'google.com' && host !== 'maps.google.com') return null;
  // An embed link from Google's "Share > Embed a map".
  if (url.pathname === '/maps/embed') {
    const pb = url.searchParams.get('pb');
    return pb && /^[\w!.:%*,-]{1,4000}$/.test(pb)
      ? `https://www.google.com/maps/embed?pb=${encodeURIComponent(pb)}`
      : null;
  }
  const query = url.searchParams.get('q');
  if (!query || query.length > 500) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

function spotify(url: URL): string | null {
  if (url.hostname !== 'open.spotify.com') return null;
  const match =
    /^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([a-zA-Z0-9]{1,64})/.exec(
      url.pathname,
    );
  return match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}` : null;
}

function soundcloud(url: URL): string | null {
  if (url.hostname !== 'soundcloud.com' && url.hostname !== 'www.soundcloud.com') return null;
  if (!/^\/[\w-]{1,100}(?:\/[\w-]{1,200}){0,2}\/?$/.test(url.pathname)) return null;
  const track = `https://soundcloud.com${url.pathname}`;
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(track)}`;
}

const BUILDERS: Record<EmbedProvider, (url: URL) => string | null> = {
  youtube,
  vimeo,
  googleMaps,
  spotify,
  soundcloud,
};

const ALLOW: Record<EmbedProvider, string> = {
  youtube: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen',
  vimeo: 'encrypted-media; picture-in-picture; fullscreen',
  googleMaps: 'fullscreen',
  spotify: 'encrypted-media; fullscreen; picture-in-picture',
  soundcloud: 'encrypted-media',
};

/**
 * The frame source for a share URL of an allow-listed provider, rebuilt from the parsed id so
 * nothing else of the URL reaches the page. `provider` narrows the match; `null` when nothing fits.
 */
export function embedFor(url: unknown, provider?: unknown): Embed | null {
  if (typeof url !== 'string' || url.length > 2000) return null;
  const parsed = parse(url.trim());
  if (!parsed) return null;
  const providers = (
    typeof provider === 'string' && Object.hasOwn(BUILDERS, provider)
      ? [provider]
      : Object.keys(BUILDERS)
  ) as EmbedProvider[];
  for (const name of providers) {
    const src = BUILDERS[name](parsed);
    if (src) return { provider: name, src, allow: ALLOW[name] };
  }
  return null;
}
