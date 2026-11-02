// Designed sites: pages of the site process, cached and uncached, their assets, the sitemap.

import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import { config, isBreakpoint } from './config.js';
import { expectStatus, pick, thinkTime } from './http.js';

const pageDuration = new Trend('site_page_duration', true);
const renderDuration = new Trend('site_render_duration', true);
const notModified = new Rate('site_not_modified');

const HTML_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': config.locale || 'en',
};

// Stylesheets, island scripts, preloaded fonts and images the site serves itself.
const ASSET_RE = /(?:href|src)="(\/(?:_site|media)\/[^"]+)"/g;
const LOC_RE = /<loc>([^<]+)<\/loc>/g;

/** The Host headers to send; none when the base URL's own host is a domain of the site. */
function hosts() {
  return config.site.hosts.length ? config.site.hosts : [null];
}

function hostHeaders(host, extra = {}) {
  return host ? { ...extra, host } : extra;
}

function label(host) {
  return host || config.site.url.replace(/^https?:\/\//, '');
}

/** The paths a sitemap lists, relative to its host. */
function sitemapPaths(xml) {
  const out = [];
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex scan
  while ((match = LOC_RE.exec(xml)) !== null) {
    const path = match[1].trim().replace(/^https?:\/\/[^/]+/, '') || '/';
    out.push(path);
  }
  return out;
}

/**
 * Setup: every host must answer its home page; its sitemap supplies the paths. With
 * SITE_SHARE_URL, the share cookie for the uncached scenario.
 */
export function discoverSite() {
  if (!config.site.url) throw new Error('SITE_URL is not set: the base URL of the site process');
  const sites = [];
  for (const host of hosts()) {
    const home = http.get(`${config.site.url}/`, {
      headers: hostHeaders(host, HTML_HEADERS),
      tags: { surface: 'setup', kind: 'probe' },
      responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
    });
    if (home.status !== 200) {
      throw new Error(
        `${label(host)} answered ${home.status}; is it a domain of a published designed space?`,
      );
    }
    const sitemap = http.get(`${config.site.url}/sitemap.xml`, {
      headers: hostHeaders(host),
      tags: { surface: 'setup', kind: 'sitemap' },
      responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
    });
    const found = sitemap.status === 200 ? sitemapPaths(String(sitemap.body)) : [];
    const paths = [...new Set([...config.site.paths, ...found])].slice(0, 200);
    sites.push({ host, name: label(host), paths });
  }
  console.log(`site: ${sites.map((s) => `${s.name} (${s.paths.length} paths)`).join(', ')}`);
  return { sites, share: config.site.shareUrl ? shareCookie() : null };
}

/** Opens the share link once; its cookie makes every page render fresh, bypassing the cache. */
function shareCookie() {
  const link = /^https?:\/\/([^/]+)(\/_manablox\/share\/[^?#]+)/.exec(config.site.shareUrl);
  if (!link) throw new Error('SITE_SHARE_URL is not a share link (.../_manablox/share/<token>)');
  const host = link[1];
  const res = http.get(`${config.site.url}${link[2]}`, {
    headers: { host },
    redirects: 0,
    tags: { surface: 'setup', kind: 'share' },
    responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
  });
  const cookie = res.cookies.mb_site_share?.[0]?.value;
  if (!cookie) throw new Error(`the share link answered ${res.status} without a cookie; expired?`);
  const hostname = host.replace(/:\d+$/, '');
  const site = hosts().find((entry) => (entry || '').replace(/:\d+$/, '') === hostname);
  return { host: site === undefined ? host : site, cookie: `mb_site_share=${cookie}` };
}

function assetUrls(html) {
  const out = new Set();
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex scan
  while ((match = ASSET_RE.exec(html)) !== null) {
    out.add(`${config.site.url}${match[1].replace(/&amp;/g, '&')}`);
    if (out.size >= 12) break;
  }
  return [...out];
}

function isHtml(res) {
  return check(res, {
    'site page: html': (r) =>
      String(r.headers['Content-Type'] || '').startsWith('text/html') &&
      String(r.body).includes('</html>'),
  });
}

/**
 * A visitor: two to four pages (one under breakpoint), the first with its assets, as a
 * browser with an empty cache fetches them. A page seen before in this session is asked
 * for again with `If-None-Match`; now and then the sitemap or robots.txt.
 */
export function siteVisitor(data) {
  const site = pick(data.site.sites);
  const tags = { surface: 'site', site: site.name };
  const etags = {};

  group(`site ${site.name}`, () => {
    const pages = isBreakpoint ? 1 : 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pages; i++) {
      const path = pick(site.paths);
      const known = etags[path];
      const res = http.get(`${config.site.url}${path}`, {
        headers: hostHeaders(
          site.host,
          known ? { ...HTML_HEADERS, 'if-none-match': known } : HTML_HEADERS,
        ),
        tags: { ...tags, kind: known ? 'revalidate' : 'page' },
      });
      if (known) {
        notModified.add(res.status === 304);
        expectStatus(res, 'site revalidate', 304);
      } else {
        pageDuration.add(res.timings.duration, { site: site.name });
        if (expectStatus(res, `site ${path}`) && isHtml(res)) {
          if (res.headers.Etag) etags[path] = res.headers.Etag;
          if (i === 0) fetchAssets(site, res.body, tags);
        }
      }
      sleep(thinkTime());
    }

    if (!isBreakpoint && Math.random() < 0.1) {
      const file = Math.random() < 0.5 ? '/sitemap.xml' : '/robots.txt';
      const res = http.get(`${config.site.url}${file}`, {
        headers: hostHeaders(site.host),
        tags: { ...tags, kind: 'sitemap' },
      });
      expectStatus(res, `site ${file}`);
    }
  });
}

function fetchAssets(site, html, tags) {
  const assets = assetUrls(String(html));
  if (!assets.length) return;
  const batch = http.batch(
    assets.map((url) => [
      'GET',
      url,
      null,
      { headers: hostHeaders(site.host), tags: { ...tags, kind: 'asset' } },
    ]),
  );
  for (const asset of batch) expectStatus(asset, 'site asset');
}

/** A page rendered on every request: the share cookie bypasses the page cache. */
export function siteRenderVisitor(data) {
  const share = data.site.share;
  if (!share) return;
  const site = data.site.sites.find((entry) => entry.host === share.host) || data.site.sites[0];
  const path = pick(site.paths);
  const res = http.get(`${config.site.url}${path}`, {
    headers: { ...hostHeaders(share.host, HTML_HEADERS), cookie: share.cookie },
    tags: { surface: 'site', site: site.name, kind: 'render' },
  });
  renderDuration.add(res.timings.duration, { site: site.name });
  if (expectStatus(res, `site render ${path}`)) isHtml(res);
  sleep(thinkTime());
}

export function siteThresholds(withRender) {
  const thresholds = {
    // Makes k6 list these sub-metrics in the summary.
    'http_reqs{surface:site,kind:page}': ['count>=0'],
    'http_reqs{surface:site,kind:asset}': ['count>=0'],
    'http_req_duration{surface:site,kind:page}': [
      `p(95)<${config.site.p95}`,
      `p(99)<${config.site.p99}`,
    ],
    'http_req_duration{surface:site,kind:asset}': [`p(95)<${config.site.p95}`],
    'http_req_failed{surface:site}': [`rate<${config.maxErrorRate}`],
  };
  if (withRender) {
    thresholds['http_req_duration{surface:site,kind:render}'] = [`p(95)<${config.site.renderP95}`];
  }
  return thresholds;
}
