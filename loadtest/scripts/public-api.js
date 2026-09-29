// Suite: public API, REST and GraphQL side by side under one profile.
//
//   docker compose run --rm k6                       # this file, PROFILE from .env
//   docker compose run --rm -e PROFILE=stress k6

import { config } from './lib/config.js';
import { applyControls, restoreControls } from './lib/controls.js';
import { hardened, scenario } from './lib/profiles.js';
import { apiThresholds, discover, graphqlVisitor, restVisitor } from './lib/public-api.js';
import { summarize } from './lib/summary.js';

export const options = {
  scenarios: {
    rest: scenario('rest', config.profile, config.vuScale * 0.5),
    graphql: scenario('graphql', config.profile, config.vuScale * 0.5),
  },
  thresholds: hardened(apiThresholds()),
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

export const handleSummary = summarize('public-api', config.profile);

// For `k6 run --vus N --duration T`, which bypasses the scenarios.
export default function (data) {
  if (Math.random() < 0.5) restVisitor(data);
  else graphqlVisitor(data);
}
