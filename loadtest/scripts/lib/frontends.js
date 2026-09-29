// Frontends: weighted page loads plus their static assets, tagged by `site`.

import { group, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { config, isBreakpoint, resolveFrontends } from './config.js';
import { expectStatus, pick, thinkTime, weightedPick } from './http.js';

export const sites = resolveFrontends();
const pageDuration = new Trend('frontend_page_duration', true);
const assetDuration = new Trend('frontend_asset_duration', true);

const HTML_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': config.locale || 'en',
  'user-agent': 'manablox-loadtest/k6',
};

// Script and stylesheet references; a regex is enough for the common shapes.
const ASSET_RE = /<(?:script[^>]+src|link[^>]+href)=["']([^"']+\.(?:js|mjs|css)(?:\?[^"']*)?)["']/g;

function assetUrls(site, html) {
  const out = new Set();
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex scan
  while ((match = ASSET_RE.exec(html)) !== null) {
    const ref = match[1];
    if (ref.startsWith('//') || /^https?:/.test(ref)) {
      if (!ref.startsWith(site.url)) continue;
      out.add(ref);
    } else {
      out.add(`${site.url}${ref.startsWith('/') ? '' : '/'}${ref}`);
    }
    if (out.size >= 12) break;
  }
  return [...out];
}

function resolvePath(path, data) {
  if (!path.includes('{permalink}')) return path;
  const permalinks = data?.permalinks || [];
  if (permalinks.length === 0) return path.replace('{permalink}', '');
  return path.replace('{permalink}', pick(permalinks));
}

export function frontendVisitor(data) {
  if (sites.length === 0) {
    throw new Error('no frontends configured: set FRONTEND_URLS or list them in targets.json');
  }
  const site = weightedPick(sites);
  const tags = { site: site.name, surface: 'frontend' };
  const headers = site.host ? { ...HTML_HEADERS, host: site.host } : HTML_HEADERS;
  const assetHeaders = site.host ? { host: site.host } : {};

  group(site.name, () => {
    // Two to four pages per session; one under breakpoint.
    const pages = isBreakpoint ? 1 : 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pages; i++) {
      const path = resolvePath(pick(site.paths), data);
      const res = http.get(`${site.url}${path}`, {
        headers,
        tags: { ...tags, kind: 'page' },
      });
      pageDuration.add(res.timings.duration, { site: site.name });
      const ok = expectStatus(res, `${site.name} ${path}`);

      if (ok && typeof res.body === 'string') {
        const assets = assetUrls(site, res.body);
        if (assets.length) {
          const batch = http.batch(
            assets.map((url) => [
              'GET',
              url,
              null,
              { headers: assetHeaders, tags: { ...tags, kind: 'asset' } },
            ]),
          );
          for (const asset of batch) {
            assetDuration.add(asset.timings.duration, { site: site.name });
            expectStatus(asset, `${site.name} asset`);
          }
        }
      }
      sleep(thinkTime());
    }
  });
}

export function frontendThresholds() {
  const thresholds = {
    // Makes k6 list this sub-metric in the summary.
    'http_reqs{surface:frontend,kind:page}': ['count>=0'],
    'http_req_duration{surface:frontend,kind:page}': [
      `p(95)<${config.frontends.p95}`,
      `p(99)<${config.frontends.p99}`,
    ],
    'http_req_failed{surface:frontend}': [`rate<${config.maxErrorRate}`],
  };
  for (const site of sites) {
    thresholds[`http_req_duration{site:${site.name},kind:page}`] = [
      `p(95)<${config.frontends.p95}`,
    ];
    thresholds[`http_req_failed{site:${site.name}}`] = [`rate<${config.maxErrorRate}`];
  }
  return thresholds;
}
