// Suite: designed sites on the site process. Cached pages with their assets and the
// sitemap; with SITE_SHARE_URL also pages rendered fresh on every request.
//
//   loadtest/run.sh site [profile] [k6 args...]

import { config } from './lib/config.js';
import { hardened, scenario } from './lib/profiles.js';
import { discoverSite, siteRenderVisitor, siteThresholds, siteVisitor } from './lib/site.js';
import { summarize } from './lib/summary.js';

const render = Boolean(config.site.shareUrl);

const scenarios = {
  pages: scenario('pages', config.profile, config.vuScale * (render ? 0.8 : 1)),
};
if (render) scenarios.render = scenario('renders', config.profile, config.vuScale * 0.2);

export const options = {
  scenarios,
  thresholds: hardened(siteThresholds(render)),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'manablox-loadtest/k6',
};

export function setup() {
  return { site: discoverSite() };
}

export const pages = siteVisitor;
export const renders = siteRenderVisitor;

export const handleSummary = summarize('site', config.profile);

// For `k6 run --vus N --duration T`, which bypasses the scenarios.
export default function (data) {
  if (render && Math.random() < 0.2) siteRenderVisitor(data);
  else siteVisitor(data);
}
