import type { ContentModel } from '@manablox/public-sdk';
import {
  type ManagementContentType,
  modelFromDelivery,
  modelFromManagement,
  type RenderModel,
} from './model.js';

/** Reads a content model from the management API (with a key) or the delivery API. */

export type Fetch = typeof globalThis.fetch;

export interface Space {
  id: string;
  name: string;
  machineName: string;
}

export interface ManagementApi {
  url: string;
  apiKey: string;
}

export async function listSpaces(api: ManagementApi, fetch: Fetch): Promise<Space[]> {
  const spaces = await call<Space[]>(api, 'spaces/list', {}, fetch);
  return [...spaces].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function managementModel(
  api: ManagementApi,
  spaceId: string,
  fetch: Fetch,
): Promise<RenderModel> {
  const types = await call<ManagementContentType[]>(api, 'contentTypes/list', { spaceId }, fetch);
  return modelFromManagement(types);
}

export async function deliveryModel(url: string, fetch: Fetch): Promise<RenderModel> {
  const target = `${url}/v1/types`;
  const response = await request(target, { headers: { accept: 'application/json' } }, fetch);
  if (response.status === 404) {
    throw new Error(`${target} was not found; is ${url} a delivery API (a public instance)?`);
  }
  if (!response.ok) throw new Error(`${target} answered ${response.status}`);
  const body = (await response.json()) as Partial<ContentModel>;
  return modelFromDelivery(body.types ?? []);
}

/** Picks a space by id or machine name, or the only one; ambiguity errors with the names. */
export function findSpace(spaces: Space[], wanted: string | undefined): Space {
  if (wanted) {
    const found = spaces.find((space) => space.id === wanted || space.machineName === wanted);
    if (!found) {
      throw new Error(`--space '${wanted}' is not one of the spaces the key can read: ${names()}`);
    }
    return found;
  }
  const [only] = spaces;
  if (spaces.length === 1 && only) return only;
  if (spaces.length === 0) throw new Error('the API key cannot read any space');
  throw new Error(`the API key can read several spaces; pick one with --space: ${names()}`);

  function names(): string {
    return spaces.map((space) => space.machineName).join(', ') || 'none';
  }
}

/** `POST /api/v1/<router>/<procedure>` with a JSON body. */
async function call<T>(api: ManagementApi, procedure: string, input: unknown, fetch: Fetch) {
  const target = `${api.url}/api/v1/${procedure}`;
  const response = await request(
    target,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': api.apiKey,
      },
      body: JSON.stringify(input),
    },
    fetch,
  );
  if (response.status === 401) throw new Error(`${api.url} refused the API key`);
  if (response.status === 403) {
    throw new Error(`the API key may not do this in that space (${procedure})`);
  }
  if (response.status === 404) {
    throw new Error(`${target} was not found; is ${api.url} a management API?`);
  }
  if (!response.ok) throw new Error(`${target} answered ${response.status}`);
  return (await response.json()) as T;
}

/** A fetch whose errors name the URL. */
async function request(target: string, init: RequestInit, fetch: Fetch): Promise<Response> {
  try {
    return await fetch(target, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not reach ${target} (${reason})`);
  }
}
