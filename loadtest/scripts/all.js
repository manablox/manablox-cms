// Suite: API and frontends together under one profile.
//
//   docker compose run --rm k6 run /loadtest/scripts/all.js

import { config } from './lib/config.js';
import { applyControls, restoreControls } from './lib/controls.js';
import { frontendThresholds, frontendVisitor, sites } from './lib/frontends.js';
import { hardened, scenario } from './lib/profiles.js';
import { apiThresholds, discover, graphqlVisitor, restVisitor } from './lib/public-api.js';
import { summarize } from './lib/summary.js';

const scenarios = {
  rest: scenario('rest', config.profile, config.vuScale * 0.3),
  graphql: scenario('graphql', config.profile, config.vuScale * 0.3),
};
if (sites.length) scenarios.frontends = scenario('visit', config.profile, config.vuScale * 0.4);

export const options = {
  scenarios,
  thresholds: hardened({
    ...apiThresholds(),
    ...(sites.length ? frontendThresholds() : {}),
  }),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'manablox-loadtest/k6',
};

export function setup() {
  return { ...discover(), controls: applyControls() };
}

export function teardown(data) {
  restoreControls(data.controls);
}

export const rest = restVisitor;
export const graphql = graphqlVisitor;
export const visit = frontendVisitor;

export const handleSummary = summarize('all', config.profile);

// For `k6 run --vus N --duration T`, which bypasses the scenarios.
export default function (data) {
  const roll = Math.random();
  if (sites.length && roll < 0.4) frontendVisitor(data);
  else if (roll < 0.7) restVisitor(data);
  else graphqlVisitor(data);
}
