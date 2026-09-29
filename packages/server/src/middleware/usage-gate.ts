import { type AnyUsageMetric, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Context } from 'hono';
import { errorResponse } from '../errors.js';
import { markNotMetered } from './served.js';

/** The `control.usage` refusal for the first of `metrics` the space has used up, if any. */
export async function usageRefused(
  manablox: Manablox,
  spaceId: string | null | undefined,
  metrics: readonly AnyUsageMetric[],
): Promise<ManabloxError | null> {
  if (!spaceId) return null;
  for (const metric of metrics) {
    try {
      await manablox.controls.assertUsage(spaceId, metric);
    } catch (error) {
      if (ManabloxError.is(error) && error.key === 'control.usage') return error;
      throw error;
    }
  }
  return null;
}

/** Seconds until a refusal's period ends. */
export function retryAfter(refusal: ManabloxError): string {
  const resetsAt = Date.parse(String(refusal.details[0]?.params?.resetsAt ?? ''));
  return String(Math.max(1, Math.ceil(((resetsAt || Date.now()) - Date.now()) / 1000)));
}

/** 429 `control.usage`, never stored by a cache, while a metric is used up; else `null`. */
export async function usageRefusal(
  c: Context,
  manablox: Manablox,
  spaceId: string | null | undefined,
  metrics: readonly AnyUsageMetric[],
): Promise<Response | null> {
  const refusal = await usageRefused(manablox, spaceId, metrics);
  if (!refusal) return null;
  markNotMetered(c);
  const response = errorResponse(c, refusal);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('retry-after', retryAfter(refusal));
  return response;
}

/** What delivery answers count against. */
export const DELIVERY_METRICS: readonly AnyUsageMetric[] = ['apiRequests', 'bandwidthBytes'];
