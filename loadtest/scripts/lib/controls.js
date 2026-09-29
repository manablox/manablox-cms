// Optional control settings for a run: `CONTROLS=on` stores `controls.settings` from
// targets.json (or the defaults below) at `CONTROLS_SCOPE` through the control API before
// the run and puts the scope's earlier values back after it.

import { sleep } from 'k6';
import http from 'k6/http';
import { config } from './config.js';

/** Flags, a soft usage limit and rate rules too high to refuse: the cost of resolving them. */
const DEFAULT_SETTINGS = {
  features: {
    restDelivery: { enabled: true },
    graphqlDelivery: { enabled: true },
    webhooks: { enabled: false, presentation: 'locked' },
    workflows: { enabled: false, presentation: 'hidden' },
    sso: { enabled: false },
  },
  usage: {
    apiRequests: { max: 1000000000, mode: 'soft', thresholds: [80, 100] },
    bandwidthBytes: { max: 10000000000000, mode: 'soft' },
  },
  rateLimits: {
    'delivery.ip': { max: 10000000, windowSeconds: 60 },
    'delivery.space': { max: 10000000, windowSeconds: 60 },
  },
};

const controls = config.controls;

function request(method, path, body) {
  const res = http.request(
    method,
    `${controls.url}/control/v1${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: { authorization: `Bearer ${controls.key}`, 'content-type': 'application/json' },
      tags: { surface: 'setup', name: 'control' },
      responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
    },
  );
  if (res.status !== 200) {
    throw new Error(`control API ${method} ${path} answered ${res.status}: ${res.body}`);
  }
  return res.json();
}

const scopeQuery = () => `?scope=${encodeURIComponent(controls.scope)}`;

/** With `CONTROLS=on`, sets the controls and returns what the scope held before. */
export function applyControls() {
  if (!controls.enabled) {
    if (controls.url) {
      const { scopes } = request('GET', '/settings');
      const stored = Object.keys(scopes || {});
      console.log(`controls off; scopes storing values: ${stored.join(', ') || 'none'}`);
    }
    return null;
  }
  if (!controls.url || !controls.key) {
    throw new Error('CONTROLS=on needs CONTROL_API_URL and CONTROL_API_KEY');
  }
  const before = request('GET', `/settings${scopeQuery()}`).settings;
  const after = request('PATCH', `/settings${scopeQuery()}`, controls.settings || DEFAULT_SETTINGS);
  console.log(
    `controls on at ${controls.scope}: ${Object.keys(after.settings).join(', ')}; ` +
      `waiting ${controls.settleSeconds}s for every process to pick them up`,
  );
  // Other processes drop their resolved controls within 5 seconds.
  sleep(controls.settleSeconds);
  return before;
}

/** Puts back what `applyControls` replaced. */
export function restoreControls(before) {
  if (!controls.enabled || before === null || before === undefined) return;
  request('PUT', `/settings${scopeQuery()}`, before);
  console.log(`controls at ${controls.scope} restored`);
}
