import { type APIRequestContext, expect, type Page, type TestInfo } from '@playwright/test';

/** Fixed, not stamped: a retry worker would re-stamp it and the second test would sign in as nobody. */
export const account = {
  name: 'E2E Owner',
  email: 'e2e-owner@example.com',
  password: 'correct horse battery staple',
};

type Info = Pick<TestInfo, 'config'>;

export const apiUrl = (info: Info) =>
  String(info.config.metadata.apiUrl ?? 'http://localhost:3000');

/** Management RPC call through the browser session. */
export const rpc = async (page: Page, path: string, input: unknown): Promise<unknown> => {
  const response = await page.request.post(`/rpc/${path}`, { data: { json: input } });
  return ((await response.json()) as { json: unknown }).json;
};

/** Signs in as the account `install.setup.ts` created. */
export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Control API call with the key the config gives the API; throws on a non-2xx answer. */
export async function control(
  request: APIRequestContext,
  info: Info,
  method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const key = String(info.config.metadata.controlKey ?? '');
  const response = await request.fetch(`${apiUrl(info)}/control/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${key}` },
    ...(body === undefined ? {} : { data: body }),
  });
  if (!response.ok()) {
    throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}
