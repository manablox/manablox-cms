import { expect, test } from '@playwright/test';
import { account } from './support';

/**
 * The prebuilt admin with the two fixture plugins (`fixtures/runtime-plugins`), on their own
 * instance: the bundles come from the server's manifest at runtime; their routes, menu
 * entries, slots and apis render.
 */
test('loads runtime plugins: routes, menu entries, slots and apis', async ({ page }) => {
  const bundles: string[] = [];
  page.on('response', (response) => {
    if (/\/admin\/plugins\/hello(-extra)?\//.test(response.url())) bundles.push(response.url());
  });

  await page.goto('/');
  await page.waitForURL(/\/(install|login)/);
  if (page.url().includes('/install')) {
    await page.getByLabel('Name').fill(account.name);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.getByRole('button', { name: /Create a space/ }).click();
    await page.getByLabel('Name', { exact: true }).fill('Hello Space');
    await page.getByRole('radio', { name: /Empty space/ }).check();
    // The plugin's `space.create.steps` entry is a stage of its own.
    const greeting = page.getByLabel('First greeting');
    for (let stage = 0; stage < 4 && !(await greeting.isVisible()); stage++) {
      await page.getByRole('button', { name: /^Next/ }).click();
    }
    await greeting.fill('Hello from the wizard');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByRole('heading', { name: 'Your instance is ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to the admin' }).click();
  } else {
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).not.toHaveURL(/\/(install|login)/);
  expect(bundles.filter((url) => url.endsWith('/entry.js'))).toHaveLength(2);

  // The menu entry and route; the wizard's greeting went through the plugin's create hook.
  await page.getByRole('navigation').first().getByRole('link', { name: 'Greetings' }).click();
  await expect(page).toHaveURL(/\/hello$/);
  await expect(page.getByRole('heading', { name: 'Greetings' })).toBeVisible();
  await expect(page.getByText('Hello from the wizard')).toBeVisible();

  // `hello-extra`'s api, exposed in its bundle's setup, which loads after hello's.
  await expect(page.getByText('* Greetings from hello *')).toBeVisible();

  // The `space.settings.sections` slot.
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Greetings' });
  await expect(section).toContainText('has 1 greetings');

  // The second plugin: words contributed on the server, and its own slot filled by hello.
  await page.getByRole('navigation').first().getByRole('link', { name: 'Greeting board' }).click();
  await expect(page).toHaveURL(/\/hello-extra$/);
  const words = page.getByRole('list', { name: 'Words' });
  await expect(words).toContainText('Hello (hello)');
  await expect(words).toContainText('Hi (hello-extra)');
  await expect(page.getByRole('region', { name: 'From other plugins' })).toContainText(
    'Hello keeps 1 greetings here.',
  );
});
