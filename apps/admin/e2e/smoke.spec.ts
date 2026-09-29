import { expect, test } from '@playwright/test';
import { apiUrl, rpc, signIn } from './support';

/** The release path, from a type to a delivery read. Runs on the instance `install.setup.ts` made. */

test('creates a type and a published document', async ({ page }, info) => {
  await signIn(page);

  // The wizard's space is current.
  await page.goto('/settings?tab=spaces');
  await expect(page.getByRole('link', { name: /Smoke Site smoke-site/ })).toBeVisible();

  // A content type with one text field.
  await page.goto('/types/new');
  await page.getByLabel('Label').fill('Article');
  await expect(page.getByLabel('Technical name')).toHaveValue('article');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: /^Text/ }).click();
  await page.locator('#field-0-label').fill('Summary');
  await expect(page.locator('#field-0-name')).toHaveValue('summary');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/types\/[0-9a-f-]{36}$/);

  // A document, saved and published.
  await page.goto('/content');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('link', { name: 'Article', exact: true }).click();
  await page.getByLabel('Title').fill('Hello, world');
  await expect(page.getByLabel('Slug')).toHaveValue('hello-world');
  await page.getByLabel('Summary').fill('The first document.');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('* Published')).toBeVisible();
  await expect(page).toHaveURL(/\/content\/[0-9a-f-]{36}$/);

  // Delivery reads the published projection. The instance is unpinned, so the request names the space.
  const spaces = await page.request.post(`${apiUrl(info)}/api/v1/spaces/list`);
  expect(spaces.ok()).toBe(true);
  const [space] = (await spaces.json()) as Array<{ id: string; machineName: string }>;
  expect(space?.machineName).toBe('smoke-site');

  const response = await page.request.post(`${apiUrl(info)}/graphql`, {
    headers: { 'x-manablox-space': space?.id ?? '' },
    data: {
      query:
        '{ contentByPermalink(permalink: "hello-world") { title ... on Article { summary } } }',
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data: { contentByPermalink: { title: string; summary: string } | null };
  };
  expect(body.data.contentByPermalink).toEqual({
    title: 'Hello, world',
    summary: 'The first document.',
  });

  // The tree marks it published.
  await page.goto('/content');
  await expect(page.getByRole('link', { name: 'Hello, world' })).toBeVisible();

  // A menu with the document and a nested link, read back through delivery. The page's button.
  await page.goto('/menus');
  await page.getByRole('main').getByRole('button', { name: 'New menu' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Main navigation');
  await expect(page.getByLabel('Technical name')).toHaveValue('main-navigation');
  await page.getByLabel('Technical name').fill('main');
  await page.getByRole('button', { name: 'Create menu' }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Add document' }).click();
  await page.getByRole('button', { name: /Hello, world/ }).click();
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Label').last().fill('Blog');
  await page.getByLabel('Address').fill('https://blog.example.test');
  await page.getByRole('button', { name: 'Nest under the entry above' }).last().click();

  // A third entry, nested by dragging onto the document's row.
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Label').last().fill('Contact');
  await page.getByLabel('Address').last().fill('/contact');
  // Dispatched events: Chromium's drag interception stalls under Playwright tracing.
  const handle = page.getByRole('button', { name: /^Contact/ }).first();
  const target = page.getByRole('button', { name: /^Hello, world/ }).first();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await handle.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await handle.dispatchEvent('dragend', { dataTransfer });
  await expect(page.getByTitle('2 nested')).toBeVisible();
  await page.screenshot({ path: info.outputPath('menu-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('unsaved')).toHaveCount(0);

  const menu = await page.request.post(`${apiUrl(info)}/graphql`, {
    headers: { 'x-manablox-space': space?.id ?? '' },
    data: {
      query:
        '{ menu(name: "main") { machineName items { label content { title } children { label url } } } }',
    },
  });
  expect(menu.ok()).toBe(true);
  const menuBody = (await menu.json()) as { data: { menu: unknown } };
  expect(menuBody.data.menu).toEqual({
    machineName: 'main',
    items: [
      {
        label: 'Hello, world',
        content: { title: 'Hello, world' },
        children: [
          { label: 'Blog', url: 'https://blog.example.test' },
          { label: 'Contact', url: '/contact' },
        ],
      },
    ],
  });

  // The document editor lists its menus.
  await page.goto('/content');
  await page.getByRole('link', { name: 'Hello, world' }).click();
  await expect(page.getByRole('link', { name: 'Main navigation' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('content-in-menus.png'), fullPage: true });

  // A custom role that writes articles only, listed beside the five built-in roles.
  await page.goto('/settings?tab=roles');
  await page.getByRole('button', { name: 'New role' }).click();
  // Scoped to the dialog: the role editor behind has its own fields.
  const roleDialog = page.getByRole('dialog');
  await roleDialog.getByLabel('Name', { exact: true }).fill('Blogger');
  await expect(roleDialog.getByLabel('Technical name')).toHaveValue('blogger');
  await roleDialog.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('button', { name: /Blogger blogger/ })).toBeVisible();
  // The editor opens on the new role; grants are ticked there.
  await page.getByLabel('read Article').check();
  await page.getByLabel('write Article').check();
  await expect(page.getByLabel('write all content types')).not.toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('unsaved')).toHaveCount(0);
  await expect(page.getByLabel('write Article')).toBeChecked();
  await page.screenshot({ path: info.outputPath('roles.png'), fullPage: true });

  // A workflow calling the health check: a test run, then published, enabled and triggered by a save.
  await page.goto('/workflows');
  await page.getByRole('main').getByRole('button', { name: 'New workflow' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Ping on save');
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Ping on save' })).toBeVisible();

  // New workflows start with a `content.status equals published` condition; nodes append.
  await expect(page.locator('.vue-flow__node')).toHaveCount(2);

  const palette = page.getByRole('button', { name: /Call an API/ });
  await expect(palette).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('workflow-palette.png') });
  await palette.click();
  await expect(page.locator('.vue-flow__node')).toHaveCount(3);

  // Adding a node selects it.
  await page.getByLabel('URL').fill(`${apiUrl(info)}/healthz`);
  await page.getByLabel('Method').click();
  await page.getByRole('option', { name: 'GET' }).click();

  await page.screenshot({ path: info.outputPath('workflow-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('unsaved')).toHaveCount(0);
  const workflowUrl = page.url();

  await page.getByRole('button', { name: 'Test run' }).click();
  await page
    .getByRole('dialog', { name: 'Test it against which document?' })
    .getByRole('button', { name: /Hello, world/ })
    .click();
  // A shown run is signalled by the badge that dismisses it.
  await expect(page.getByRole('button', { name: 'Stop showing the run' })).toBeVisible();

  // The Runs tab lists it; the run's own page shows its steps.
  await page.getByRole('tab', { name: 'Runs' }).click();
  const runs = page.getByRole('link', { name: /^Run of/ });
  await expect(runs).toHaveCount(1);
  await expect(runs.first()).toContainText('Test run');
  await expect(runs.first()).toContainText('Hello, world');
  await expect(page.getByText('Succeeded')).toBeVisible();
  await runs.first().click();
  // The message shows on the run and on its node.
  await expect(page.getByText('HTTP 200').first()).toBeVisible();
  await expect(page.getByText('taking the yes side').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('workflow-runs.png'), fullPage: true });

  // Published and switched on, a document save triggers it. The switch only shows with no
  // node selected, so the editor is opened afresh.
  await page.goto(workflowUrl);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Publish version 1' })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(page.getByText('Version 1 is live')).toBeVisible();
  await page.getByRole('switch', { name: /Switched off/ }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('unsaved')).toHaveCount(0);
  await page.goto('/content');
  await page.getByRole('link', { name: 'Hello, world' }).click();
  await page.getByLabel('Summary').fill('The first document, saved again.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.goto(workflowUrl);
  await page.getByRole('tab', { name: 'Runs' }).click();
  await expect(runs).toHaveCount(2);
  await expect(runs.first()).not.toContainText('Test run');
  await expect(page.getByText('Succeeded')).toHaveCount(2);
});

/** A space with the basic setup. Signs in as the account `install.setup.ts` created. */
test('creates a space with the basic setup', async ({ page }) => {
  await signIn(page);

  // The query preselects the setup.
  await page.goto('/settings?new=space&setup=basic');
  // Scoped to the dialog: the panel behind has its own Name field.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /Preconfigured/ })).toBeChecked();
  await dialog.getByLabel('Name', { exact: true }).fill('Starter Site');
  await dialog.getByRole('button', { name: 'Next: website type' }).click();
  await expect(dialog.getByRole('radio', { name: /Basic setup/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Create space' }).click();
  await expect(page.getByText('created with the basic setup')).toBeVisible();
  await expect(page.getByRole('link', { name: /Starter Site starter-site/ })).toBeVisible();

  // What the setup made, read over RPC.
  const spaces = (await rpc(page, 'spaces/list', null)) as { id: string; machineName: string }[];
  const space = spaces.find((entry) => entry.machineName === 'starter-site');
  expect(space).toBeDefined();
  const spaceId = (space as { id: string }).id;

  const types = (await rpc(page, 'contentTypes/list', { spaceId })) as { name: string }[];
  // `folder` and `template` are built into every space.
  expect(types.map((type) => type.name).sort()).toEqual([
    'article',
    'folder',
    'page',
    'teaser',
    'template',
  ]);
  const documents = (await rpc(page, 'content/list', {
    filter: { spaceId },
    page: { limit: 20, offset: 0 },
  })) as { items: { slug: string; status: string }[] };
  expect(documents.items.map((row) => row.slug).sort()).toEqual([
    'about',
    'blog',
    'hello-world',
    'home',
  ]);
  expect(documents.items.every((row) => row.status === 'published')).toBe(true);
  const menus = (await rpc(page, 'menus/list', { spaceId })) as { machineName: string }[];
  expect(menus.map((menu) => menu.machineName)).toEqual(['main']);
});

/** Block board pointer handling: draw, drag, resize. The arithmetic is in `test/block-board.test.ts`. */
test('draws, moves and resizes a block on the grid', async ({ page }) => {
  await signIn(page);

  // A block type and a content type with a blocks field.
  await page.goto('/types/new?kind=block');
  await page.getByLabel('Label').fill('Card');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: /^Text/ }).click();
  await page.locator('#field-0-label').fill('Heading');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/types\/[0-9a-f-]{36}$/);

  await page.goto('/types/new');
  await page.getByLabel('Label').fill('Board page');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: /^Blocks/ }).click();
  await page.locator('#field-0-label').fill('Body');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/types\/[0-9a-f-]{36}$/);

  await page.goto('/content');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('link', { name: 'Board page', exact: true }).click();
  await page.getByLabel('Title').fill('Board');

  // Four desktop columns make the field a board.
  await page.getByRole('button', { name: /Use a grid|Change grid/ }).click();
  await page.getByLabel('Desktop columns').fill('4');
  await page.getByLabel('Desktop columns').press('Tab');
  await page.getByRole('button', { name: 'Done' }).click();

  const board = page.getByRole('group', { name: 'Blocks on the grid' });
  await expect(board).toBeVisible();
  const cell = (column: number, row: number) =>
    board.locator(`[data-column="${column}"][data-row="${row}"]`);

  // Drawn across the top row's first two cells; opens for editing.
  await cell(1, 1).hover();
  await page.mouse.down();
  await cell(2, 1).hover();
  await page.mouse.up();
  await expect(page.getByText('Column 1, row 1, 2 x 1')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // A drag moves by the cells crossed, not to the cell under the pointer.
  const card = board.getByRole('button', { name: /^Card/ });
  await expect(card).toHaveAttribute('aria-label', /column 1, row 1/);
  await card.hover();
  await page.mouse.down();
  await cell(3, 2).hover();
  await page.mouse.up();
  await expect(card).toHaveAttribute('aria-label', /column 3, row 2/);

  // Resized by its left edge: the right edge stays put.
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    (box as { x: number }).x + 2,
    (box as { y: number; height: number }).y + (box as { height: number }).height / 2,
  );
  await page.mouse.down();
  await cell(1, 2).hover();
  await page.mouse.up();
  await expect(card).toHaveAttribute('aria-label', /column 1, row 2/);
  await expect(page.getByText('Width').locator('..').locator('span.w-6')).toHaveText('4');

  await page.screenshot({ path: 'test-results/block-board.png' });
});

/** A link field end to end, and duplicating the document that carries it. */
test('links a document, and duplicates one', async ({ page }, info) => {
  await signIn(page);

  // A type with a link field.
  await page.goto('/types/new');
  await page.getByLabel('Label').fill('Landing');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: /^Link/ }).click();
  await page.locator('#field-0-label').fill('Call to action');
  await expect(page.getByLabel('A document in this space')).toBeChecked();
  // The panel shows the server's defaults.
  await expect(page.locator('#field-0-defaultTarget')).toHaveText('The same tab');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/types\/[0-9a-f-]{36}$/);

  const newLanding = async (title: string) => {
    await page.goto('/content');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('link', { name: 'Landing', exact: true }).click();
    await page.getByLabel('Title').fill(title);
  };

  // The document the link points at.
  await newLanding('Link target');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('* Published')).toBeVisible();

  // And the one that points at it, in a new tab.
  await newLanding('Link source');
  const points = page.getByRole('group', { name: 'Call to action: what it points at' });
  await points.getByRole('button', { name: 'A document' }).click();
  await page.getByRole('button', { name: 'Pick a document' }).click();
  await page.getByRole('button', { name: /Link target/ }).click();
  await page
    .getByRole('group', { name: 'Call to action: where it opens' })
    .getByRole('button', { name: 'New tab' })
    .click();
  await page.getByLabel('Call to action: link text').fill('Read on');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('* Published')).toBeVisible();

  // Delivery resolves the address. The header picks the space: two spaces now have an `article` type.
  const spaces = (await rpc(page, 'spaces/list', null)) as { id: string }[];
  let spaceId = '';
  for (const space of spaces) {
    const types = (await rpc(page, 'contentTypes/list', { spaceId: space.id })) as {
      name: string;
    }[];
    if (types.some((type) => type.name === 'landing')) {
      spaceId = space.id;
      break;
    }
  }
  expect(spaceId).not.toBe('');

  const response = await page.request.post(`${apiUrl(info)}/graphql`, {
    headers: { 'x-manablox-space': spaceId },
    data: {
      query:
        '{ contentByPermalink(permalink: "link-source") { ... on Landing { callToAction { mode target label href content { title } } } } }',
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: { contentByPermalink: { callToAction: unknown } | null };
    errors?: unknown;
  };
  expect(body.errors, JSON.stringify(body)).toBeUndefined();
  expect(body.data?.contentByPermalink?.callToAction).toEqual({
    mode: 'internal',
    target: '_blank',
    label: 'Read on',
    href: 'link-target',
    content: { title: 'Link target' },
  });

  // Reloaded, the field shows what was saved.
  await page.reload();
  await expect(page.getByText('/link-target')).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Call to action: where it opens' })
      .getByRole('button', { name: 'New tab' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Call to action: link text')).toHaveValue('Read on');

  // Duplicating opens the copy as a draft.
  await page.getByRole('button', { name: 'Duplicate document' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Link source (copy)');
  await expect(page.getByLabel('Slug')).toHaveValue('link-source-copy');
  await expect(page.getByText('* Published')).toHaveCount(0);
  // The copy keeps the link.
  await expect(page.getByText('/link-target')).toBeVisible();

  await page.goto('/content');
  await expect(page.getByRole('link', { name: 'Link source (copy)' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('link-and-duplicate.png'), fullPage: true });
});

/** The image editor: upload, its three modes, a turn, and the saved result. */
test('turns, crops and colours an image', async ({ page }, info) => {
  await signIn(page);

  // Four quadrants make a turn and a mirror visible.
  await page.goto('/assets');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'stripe.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_160X80, 'base64'),
  });
  // An upload selects itself.
  await expect(page.getByRole('button', { name: /stripe/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit image' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('160 x 80 at 0, 0')).toBeVisible();

  // A quarter turn swaps the axes and resets the crop.
  await dialog.getByRole('button', { name: 'Turn a quarter right' }).click();
  await expect(dialog.getByText('80 x 160 at 0, 0')).toBeVisible();
  // The mirror is stored pre-turn (sharp's order), but the button acts on screen axes.
  await dialog.getByRole('button', { name: 'Mirror left to right' }).click();
  await expect(dialog.getByText('90')).toContainText('mirrored');

  // Focal point mode hides the crop handles.
  await dialog.getByRole('button', { name: 'Focal point' }).click();
  await expect(dialog.getByRole('button', { name: /^Resize crop/ })).toHaveCount(0);
  await expect(dialog.getByText('centred')).toBeVisible();

  // And so is colour.
  await dialog.getByRole('button', { name: 'Colour', exact: true }).click();
  await dialog.getByLabel('Contrast').fill('1.4');
  const sepia = dialog
    .getByRole('group', { name: 'Effect' })
    .getByRole('button', { name: 'Sepia' });
  await sepia.click();
  await expect(sepia).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('image-editor.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Save edits' }).click();

  // The panel and the reopened editor show what was saved.
  await expect(page.getByText('90')).toBeVisible();
  await expect(page.getByText('sepia')).toBeVisible();
  await page.getByRole('button', { name: /Edit the image/ }).click();
  await expect(page.getByRole('dialog').getByText('90')).toBeVisible();
});

/** A 160x80 PNG of four coloured quadrants. */
const PNG_160X80 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABQCAIAAAARP+ljAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA+0lEQVR42u3aoRXAIBBEQcqhCCqhTspBp474uHVcmPdWfzPyrj1zhxvhzur3OcLtcGf1G2DAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgC8Grg2W9quDpX3AgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAHfDOzg76MDMGDAgAEDBgwYMGDAgC8CXjvcCHdWv68Rboc7qw8YMGDAgAEDBgwYMGDAgL/AtcHSfnWwtA8YMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMOCbgR38fXQABgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgz4h8AvaB0YsUSVr2QAAAAASUVORK5CYII=';
