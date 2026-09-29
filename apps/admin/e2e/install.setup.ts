import { expect, test as setup } from '@playwright/test';
import { account, signIn } from './support';

/**
 * The install wizard on an empty instance: the account every test signs in as, and the
 * smoke test's empty space (the basic setup's `article` would collide with the one it
 * creates). A retry on an installed instance only checks the account.
 */
setup('installs the instance', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL(/\/(install|login)/);
  if (page.url().includes('/login')) {
    await signIn(page);
    return;
  }

  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Add your first space' })).toBeVisible();
  await page.getByRole('button', { name: /Create a space/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Smoke Site');
  await expect(page.getByLabel('Technical name')).toHaveValue('smoke-site');
  await page.getByRole('radio', { name: /Empty space/ }).check();
  await page.getByRole('button', { name: 'Create space' }).click();

  await expect(page.getByRole('heading', { name: 'Your instance is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to the admin' }).click();
  await expect(page).not.toHaveURL(/\/install/);
});
