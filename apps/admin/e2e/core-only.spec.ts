import { expect, type Page, test } from '@playwright/test';
import { account } from './support';

/** What the feature plugins put on screen: their menu entries, tabs, buttons and words. */
const PLUGIN_WORDS = /workflow|webhook|\bAI\b|designed site|site design|describe (it|a )/i;

/** The pages every space has, with the heading each one shows. */
const PAGES = [
  { path: '/', heading: /./ },
  { path: '/content', heading: /./ },
  { path: '/templates', heading: /Templates/ },
  { path: '/assets', heading: /Assets/ },
  { path: '/types', heading: /Content types/ },
  { path: '/activity', heading: /Activity/ },
];

/** Installs the instance with an empty space, or signs in on a retry. */
async function enter(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL(/\/(install|login)/);
  if (page.url().includes('/install')) {
    await page.getByLabel('Name').fill(account.name);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.getByRole('button', { name: /Create a space/ }).click();
    await page.getByLabel('Name', { exact: true }).fill('Core Space');
    await page.getByRole('radio', { name: /Empty space/ }).check();
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByRole('heading', { name: 'Your instance is ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to the admin' }).click();
  } else {
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).not.toHaveURL(/\/(install|login)/);
}

/**
 * The prebuilt admin on an instance without the feature plugins (`@manablox/api`'s
 * `serve:core-only`): no plugin bundle loads, nothing of AI, workflows, webhooks or designed
 * sites shows, and no page logs an error.
 */
test('the core alone shows no feature plugin and logs no error', async ({ page }) => {
  const bundles: string[] = [];
  page.on('response', (response) => {
    if (/\/admin\/plugins\/[^/]+\//.test(response.url())) bundles.push(response.url());
  });
  await enter(page);
  // Signed in; the signed-out session check before answers 401 on purpose.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const menu = page.getByRole('navigation').first();
  await expect(menu.getByRole('link', { name: 'Content', exact: true })).toBeVisible();
  for (const name of ['Workflows', 'Webhooks', 'Design']) {
    await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
  }

  for (const { path, heading } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText(PLUGIN_WORDS);
  }
  // Every settings tab is the core's.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'This space', exact: true })).toBeVisible();
  const tabs = await page
    .locator('a[href*="/settings?tab="]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(tabs.length).toBeGreaterThan(3);
  expect(tabs.join(' ')).not.toMatch(/tab=(ai|workflows|webhooks|website)/);
  for (const tab of new Set(tabs)) {
    await page.goto(tab);
    await expect(page.locator('main')).not.toContainText(PLUGIN_WORDS);
  }

  expect(bundles).toEqual([]);
  expect(errors).toEqual([]);
});
