// Suite: frontends from FRONTEND_URLS and config/targets.json.
//
//   docker compose run --rm k6 run /loadtest/scripts/frontends.js
//   docker compose --profile suite run --rm frontends

import http from 'k6/http';
import { config } from './lib/config.js';
import { frontendThresholds, frontendVisitor, sites } from './lib/frontends.js';
import { withQuery } from './lib/http.js';
import { hardened, scenario } from './lib/profiles.js';
import { summarize } from './lib/summary.js';

export const options = {
  scenarios: {
    frontends: scenario('visit', config.profile, config.vuScale),
  },
  thresholds: hardened(frontendThresholds()),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'manablox-loadtest/k6',
};

export function setup() {
  console.log(
    `frontends: ${sites.map((s) => `${s.name} (${s.url}, weight ${s.weight})`).join(', ')}`,
  );
  for (const site of sites) {
    const res = http.get(site.url, {
      headers: site.host ? { host: site.host } : {},
      tags: { surface: 'setup', kind: 'probe' },
      responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
    });
    if (res.status >= 400 || res.status === 0) {
      throw new Error(`${site.name} at ${site.url} answered ${res.status}; is it running?`);
    }
  }
  // Permalinks for `{permalink}` placeholders; best effort.
  const permalinks = [];
  try {
    const res = http.get(
      `${config.publicApi.url}${withQuery('/v1/content', { limit: 100, locale: config.locale || undefined })}`,
      {
        tags: { surface: 'setup', name: 'discover' },
        responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
      },
    );
    if (res.status === 200) {
      for (const item of res.json().items || []) {
        if (item.permalink) permalinks.push(item.permalink.replace(/^\/+/, ''));
      }
    }
  } catch {
    // no API, no placeholders
  }
  return { permalinks };
}

export const visit = frontendVisitor;

export const handleSummary = summarize('frontends', config.profile);

// For `k6 run --vus N --duration T`, which bypasses the scenarios.
export default frontendVisitor;
