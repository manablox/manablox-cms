import { type APIRequestContext, expect, type Page, type TestInfo, test } from '@playwright/test';
import { control, rpc, signIn } from './support';

/**
 * What the admin shows for values the control API sets. The tests share one space made
 * through the control API; each one resets the instance and space scopes when it ends.
 */

const SPACE = { name: 'Controls Site', machineName: 'controls-site' };

let spaceId = '';

/** Signs in with the controls space current. */
async function enter(page: Page) {
  await page.addInitScript((id) => localStorage.setItem('manablox.space', id), spaceId);
  await signIn(page);
}

async function open(page: Page, path: string) {
  await enter(page);
  await page.goto(path);
}

async function reset(request: APIRequestContext, info: TestInfo) {
  await control(request, info, 'PUT', '/settings?scope=instance', {});
  if (spaceId) await control(request, info, 'PUT', `/settings?scope=space:${spaceId}`, {});
}

test.beforeAll(async ({ request }, info) => {
  const { items } = (await control(request, info, 'GET', '/spaces')) as {
    items: { id: string; machineName: string }[];
  };
  // A retry reuses the space an earlier attempt left.
  const existing = items.find((space) => space.machineName === SPACE.machineName);
  spaceId =
    existing?.id ?? ((await control(request, info, 'POST', '/spaces', SPACE)) as { id: string }).id;
});

test.afterEach(async ({ request }, info) => {
  await reset(request, info);
});

test.afterAll(async ({ browser }, info) => {
  const page = await browser.newPage({ baseURL: String(info.project.use.baseURL) });
  await reset(page.request, info);
  await signIn(page);
  await rpc(page, 'spaces/delete', { spaceId });
  await page.close();
});

test('hidden and locked features', async ({ page, request }, info) => {
  await enter(page);
  const created = (await rpc(page, 'contentTypes/create', {
    spaceId,
    name: 'page',
    label: 'Page',
    kind: 'content',
    fields: [],
  })) as { id: string };
  const doc = (await rpc(page, 'content/create', {
    spaceId,
    typeId: created.id,
    title: 'Locked schedule',
  })) as { id: string };

  await control(request, info, 'PATCH', `/settings?scope=space:${spaceId}`, {
    features: {
      'plugins.workflows': { enabled: false, presentation: 'hidden' },
      menus: {
        enabled: false,
        presentation: 'locked',
        message: 'Menus come with the Team plan.',
        link: 'https://example.com/plans',
      },
      scheduledPublishing: { enabled: false, presentation: 'locked' },
    },
  });
  await control(request, info, 'PATCH', '/settings?scope=instance', {
    admin: { links: { upgrade: 'https://example.com/upgrade' } },
  });

  await page.goto('/');
  const sidebar = page.getByRole('navigation').first();
  await expect(sidebar.getByRole('link', { name: 'Webhooks' })).toBeVisible();
  // Hidden: no entry, and the page answers neutrally.
  await expect(sidebar.getByRole('link', { name: /Workflows/ })).toHaveCount(0);
  // Locked: an entry with a lock that opens the locked panel.
  await sidebar.getByRole('link', { name: 'Menus (locked)' }).click();
  await expect(page).toHaveURL(/\/menus$/);
  await expect(page.getByText('Menus is locked')).toBeVisible();
  await expect(page.getByText('Menus come with the Team plan.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'See how to unlock' })).toHaveAttribute(
    'href',
    'https://example.com/plans',
  );

  await page.goto('/workflows');
  await expect(page.getByText('This page is not available')).toBeVisible();
  await expect(page.getByText('It is switched off on this instance.')).toBeVisible();

  // Inline: the schedule button is a lock whose popover falls back to the upgrade link.
  await page.goto(`/content/${doc.id}`);
  await page.getByRole('button', { name: 'Schedule - locked' }).click();
  const popover = page.getByRole('dialog').filter({ hasText: 'Scheduled publishing is locked' });
  await expect(popover).toBeVisible();
  await expect(popover.getByText('It is not available here at the moment.')).toBeVisible();
  await expect(popover.getByRole('link', { name: 'See how to unlock' })).toHaveAttribute(
    'href',
    'https://example.com/upgrade',
  );
});

test('a count limit refuses with its message', async ({ page, request }, info) => {
  await enter(page);
  await rpc(page, 'menus/create', { spaceId, name: 'Footer', machineName: 'footer' });
  const menus = (await rpc(page, 'menus/list', { spaceId })) as unknown[];
  await control(request, info, 'PATCH', `/settings?scope=space:${spaceId}`, {
    limits: { menusPerSpace: { max: menus.length, mode: 'hard' } },
  });

  await page.goto('/menus');
  await page.getByRole('main').getByRole('button', { name: 'New menu' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Header');
  await page.getByRole('button', { name: 'Create menu' }).click();
  await expect(
    page
      .getByText(
        `The limit of ${menus.length} ${menus.length === 1 ? 'menu' : 'menus'} per space is reached`,
      )
      .first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/menus$/);
});

test('a used-up usage limit shows the blocked banner', async ({ page, request }, info) => {
  await control(request, info, 'PATCH', `/settings?scope=space:${spaceId}`, {
    usage: { bandwidthBytes: { max: 1000, mode: 'hard' } },
  });
  // A figure from outside counts like served bytes and re-evaluates the levels.
  await control(request, info, 'POST', '/usage/external', {
    idempotencyKey: `e2e-${Date.now()}`,
    spaceId,
    metric: 'bandwidthBytes',
    period: new Date().toISOString().slice(0, 7),
    value: 1000,
    mode: 'set',
  });
  await expect
    .poll(async () => {
      const state = (await control(request, info, 'GET', '/state')) as {
        usage: Record<string, Record<string, { level: string }>>;
      };
      return state.usage[`space:${spaceId}`]?.bandwidthBytes?.level;
    })
    .toBe('blocked');

  await open(page, '/');
  const banner = page.getByRole('alert').filter({ hasText: 'Bandwidth used up' });
  await expect(banner).toContainText(`in ${SPACE.name}`);
  await expect(banner).toContainText('The site, media and the delivery API are unavailable.');
  await banner.getByRole('link', { name: 'Bandwidth usage' }).click();
  await expect(page).toHaveURL(/usage/);
});

test('instance banners and a dismissal that persists', async ({ page, request }, info) => {
  const id = `e2e-${Date.now()}`;
  await control(request, info, 'PATCH', '/settings?scope=instance', {
    admin: {
      banners: [
        {
          id,
          level: 'warning',
          text: 'Maintenance on Sunday.',
          dismissible: true,
          audience: 'all',
        },
        {
          id: `${id}-info`,
          level: 'info',
          text: 'New plans are out.',
          dismissible: false,
          audience: 'all',
        },
      ],
      links: { support: 'https://example.com/support' },
    },
  });

  await open(page, '/');
  const banners = page.getByTestId('control-banners');
  const maintenance = banners.getByRole('alert').filter({ hasText: 'Maintenance on Sunday.' });
  await expect(maintenance).toBeVisible();
  await expect(banners.getByText('New plans are out.')).toBeVisible();

  // The help menu lists the links.
  await page.getByRole('button', { name: 'Help and account links' }).click();
  await expect(page.getByRole('link', { name: 'Support' })).toHaveAttribute(
    'href',
    'https://example.com/support',
  );
  await page.keyboard.press('Escape');

  await maintenance.getByRole('button', { name: 'Dismiss' }).click();
  await expect(maintenance).toHaveCount(0);
  await page.reload();
  await expect(banners.getByText('New plans are out.')).toBeVisible();
  await expect(page.getByText('Maintenance on Sunday.')).toHaveCount(0);
});

test('a read-only instance refuses writes', async ({ page, request }, info) => {
  await control(request, info, 'PUT', '/instance/state', {
    status: 'readOnly',
    message: 'Maintenance until 14:00 UTC.',
  });

  await open(page, '/menus');
  const notice = page.getByTestId('control-banners').getByRole('status');
  await expect(notice).toContainText('This instance is read-only.');
  await expect(notice).toContainText('Maintenance until 14:00 UTC.');

  await page.getByRole('main').getByRole('button', { name: 'New menu' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Blocked');
  await page.getByRole('button', { name: 'Create menu' }).click();
  await expect(
    page.getByText('This is read-only at the moment - changes are not saved.').first(),
  ).toBeVisible();
});

test('a suspended instance shows only the suspended page', async ({ page, request }, info) => {
  await control(request, info, 'PATCH', '/settings?scope=instance', {
    admin: { links: { support: 'https://example.com/support' } },
  });
  await open(page, '/');
  await expect(page.getByTestId('suspended-panel')).toHaveCount(0);

  await control(request, info, 'PUT', '/instance/state', {
    status: 'suspended',
    message: 'Your trial has ended.',
  });
  await page.reload();
  const panel = page.getByTestId('suspended-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Your trial has ended.');
  await expect(panel.getByRole('link', { name: 'Support' })).toHaveAttribute(
    'href',
    'https://example.com/support',
  );
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await control(request, info, 'PUT', '/instance/state', { status: 'active' });
  await panel.getByRole('button', { name: 'Check again' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('navigation').first()).toBeVisible();
});
