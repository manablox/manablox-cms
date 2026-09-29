// Text summary on stdout plus a JSON file per run in results/.

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { config } from './config.js';
import { parseDuration } from './profiles.js';

export function summarize(suite, profile) {
  return (data) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tag = config.controls.enabled ? '-controls' : '';
    const file = `/results/${suite}-${profile}${tag}-${stamp}.json`;
    const report = profile === 'breakpoint' ? breakpointReport(data) : '';
    return {
      stdout: textSummary(data, { indent: ' ', enableColors: true }) + report,
      [file]: JSON.stringify(data, null, 2),
    };
  };
}

function value(data, metric, key) {
  const m = data.metrics[metric];
  return m?.values?.[key];
}

function fmt(n, digits = 0) {
  return n === undefined || Number.isNaN(n) ? 'n/a' : n.toFixed(digits);
}

/** Derives the requested rate at abort from elapsed time; capacity is just under it. */
function breakpointReport(data) {
  const bp = config.breakpoint;
  const rampMs = parseDuration(bp.ramp);
  const setupMs = value(data, 'setup_duration', 'avg') ?? 0;
  const elapsedMs = Math.max(0, (data.state?.testRunDurationMs ?? 0) - setupMs);
  const fraction = Math.min(1, elapsedMs / rampMs);
  const targetAtEnd = bp.startRate + (bp.maxRate - bp.startRate) * fraction;
  const delayMs = parseDuration(bp.abortDelay);
  const targetAtBreak =
    bp.startRate +
    (bp.maxRate - bp.startRate) * Math.min(1, Math.max(0, elapsedMs - delayMs) / rampMs);
  const aborted = fraction < 1;

  const crossed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([name]) => name);

  const lines = [
    '',
    '== breakpoint',
    aborted
      ? `   stopped after ${fmt(elapsedMs / 1000)}s of a ${bp.ramp} ramp: ${crossed.join(', ') || 'threshold'} crossed`
      : `   completed the full ${bp.ramp} ramp without crossing a threshold: the instance takes more than ${fmt(bp.maxRate)} req/s, raise BREAKPOINT_MAX_RPS`,
    `   requested rate at stop   ${fmt(targetAtEnd)} req/s (target across all scenarios)`,
    `   rate where trouble began ${fmt(targetAtBreak)} req/s (one abort delay of ${bp.abortDelay} earlier)`,
    `   achieved over the run    ${fmt(value(data, 'http_reqs', 'rate'), 1)} req/s average, ${fmt(value(data, 'http_reqs', 'count'))} requests`,
    `   dropped iterations       ${fmt(value(data, 'dropped_iterations', 'count') ?? 0)}`,
    `   http_req_duration        p95 ${fmt(value(data, 'http_req_duration', 'p(95)'), 1)} ms, p99 ${fmt(value(data, 'http_req_duration', 'p(99)'), 1)} ms`,
    `   http_req_failed          ${fmt((value(data, 'http_req_failed', 'rate') ?? 0) * 100, 2)} %`,
    `   VUs in use at the end    ${fmt(value(data, 'vus', 'value'))} of ${bp.maxVus}`,
    '',
    '   The sustainable maximum is around the rate where trouble began. For a firmer number, run',
    '   the load profile at that rate minus a margin and confirm the thresholds hold for minutes.',
    '',
  ];
  return lines.join('\n');
}
