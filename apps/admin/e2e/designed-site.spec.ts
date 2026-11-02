import { expect, type Frame, type Locator, type Page, test } from '@playwright/test';
import { rpc, signIn, siteUrl } from './support';

/**
 * A designed site end to end: the admin designs it on the site process's canvas, publishes,
 * and the site process serves it on the space's domain (`localhost`, so a browser reaches it
 * on the site's own port). Signs in as the account `install.setup.ts` created.
 */

const SPACE = { name: 'Designed Site', machineName: 'designed-site' };
const ACCENT = '#ff0055';
const VIOLET = 'rgb(109, 40, 217)';

/** The design canvas, once the admin reports it connected. */
async function canvas(page: Page): Promise<Frame> {
  await expect(page.getByText('Canvas connected')).toBeVisible();
  let frame: Frame | undefined;
  await expect
    .poll(() => {
      frame = page.frames().find((entry) => entry.url().includes('/_manablox/canvas'));
      return frame !== undefined;
    })
    .toBe(true);
  return frame as Frame;
}

/**
 * Drags a palette button onto the canvas, just inside `selector`'s lower edge, with the real
 * mouse: the admin relays the drag into the cross-origin canvas.
 */
async function dropElement(page: Page, frame: Frame, selector: string, label: string) {
  const target = frame.locator(selector).first();
  await target.waitFor();
  const inFrame = await target.boundingBox();
  const source = await page.getByRole('button', { name: label, exact: true }).first().boundingBox();
  if (!inFrame || !source) throw new Error('drag source or target not visible');
  const to = { x: inFrame.x + inFrame.width / 2, y: inFrame.y + inFrame.height - 2 };
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++)
    await page.mouse.move(
      source.x + ((to.x - source.x) * step) / 12,
      source.y + ((to.y - source.y) * step) / 12,
    );
  await page.mouse.up();
}

/** Picks an option of a ui/Select by its label. */
async function choose(page: Page, scope: Page | Locator, label: string, option: string | RegExp) {
  await scope.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test('designs, publishes and serves a designed site', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const site = siteUrl(info);
  await signIn(page);

  let spaceId = '';
  let contactTypeId = '';

  await test.step('a space with the basic setup and a databag type', async () => {
    // A retry starts over; the space takes its domain with it.
    const before = (await rpc(page, 'spaces/list', null)) as { id: string; machineName: string }[];
    const leftover = before.find((entry) => entry.machineName === SPACE.machineName);
    if (leftover) await rpc(page, 'spaces/delete', { spaceId: leftover.id });

    await page.goto('/settings?new=space&setup=basic');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(SPACE.name);
    // The switch on the Design page is tested below.
    await dialog.getByRole('radio', { name: /Own frontend/ }).check();
    // The wizard's second stage: the preselected basic setup.
    await dialog.getByRole('button', { name: 'Next: website type' }).click();
    await expect(dialog.getByRole('radio', { name: /Basic setup/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByText('created with the basic setup')).toBeVisible();

    const spaces = (await rpc(page, 'spaces/list', null)) as { id: string; machineName: string }[];
    spaceId = spaces.find((entry) => entry.machineName === SPACE.machineName)?.id ?? '';
    expect(spaceId).not.toBe('');

    // Where the site's form stores what visitors send.
    const contact = (await rpc(page, 'contentTypes/create', {
      spaceId,
      name: 'contact',
      label: 'Contact',
      kind: 'data',
      fields: [
        { name: 'name', label: 'Name', type: 'string', required: true },
        { name: 'message', label: 'Message', type: 'string' },
      ],
    })) as { id: string };
    contactTypeId = contact.id;

    await page.goto('/design');
    await page.getByRole('combobox', { name: 'Space' }).click();
    await page.getByRole('option', { name: SPACE.name }).click();
    await expect(page.getByRole('combobox', { name: 'Space' })).toHaveText(SPACE.name);
  });

  await test.step('switches to a designed site with a starter theme', async () => {
    await page.goto('/design');
    await choose(page, page, 'Start from', /^Bold/);
    await page.getByRole('button', { name: 'Switch to a designed site' }).click();
    await expect(page.getByRole('heading', { name: 'Parts of your site' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Publish all/ })).toBeEnabled();
  });

  await test.step('a theme color change repaints the canvas', async () => {
    await page.goto('/design/theme');
    const frame = await canvas(page);
    const accent = () =>
      frame.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mb-color-accent').trim(),
      );
    await expect.poll(accent).toBe('#c6f432');
    // `accent` names the palette's lime.
    const lime = page.getByRole('textbox', { name: 'Color lime', exact: true });
    await lime.fill(ACCENT);
    await lime.press('Tab');
    await expect.poll(accent).toBe(ACCENT);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  });

  await test.step('adds localhost as the domain', async () => {
    await page.goto('/settings?tab=apiHosts');
    await page.getByRole('button', { name: 'Add domain' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a domain' });
    await dialog.getByLabel('Host name').fill('localhost');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('link', { name: 'Open localhost' })).toBeVisible();
  });

  await test.step('designs the teaser block: element, binding, style, form', async () => {
    await page.goto('/design/blocks');
    await page.getByRole('main').getByRole('link', { name: 'Teaser', exact: true }).click();
    const frame = await canvas(page);

    // From the palette onto the canvas, below the headline.
    const pane = page.getByRole('complementary', { name: 'Elements' });
    await pane.getByRole('button', { name: 'Add', exact: true }).click();
    await dropElement(page, frame, '[data-mb-el="heading"]', 'Text');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem', { name: /^Text Text/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await choose(page, inspector, 'Shows', 'Headline');
    await expect(page.getByRole('treeitem', { name: /^Headline Text/ })).toBeVisible();

    await inspector.getByRole('tab', { name: 'Style' }).click();
    await inspector.getByRole('button', { name: 'Text color' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'violet', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const texts = [...document.querySelectorAll('[data-mb-el="text"]')];
          return texts.map((element) => getComputedStyle(element).color);
        }),
      )
      .toContain(VIOLET);

    // A form for the only databag type, appended to the block's root with its plus.
    await page.getByRole('treeitem', { name: /^Collapse Stack Stack/ }).click();
    await pane.getByRole('button', { name: 'Add an element inside Stack' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Form', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: /^Collapse Form Form/ })).toBeVisible();
    await expect(inspector.getByRole('combobox', { name: 'Stores entries in' })).toHaveText(
      'Contact',
    );
    await expect(frame.locator('form.mb-e-form')).toBeVisible();

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Teaser live/ })).toBeVisible();
  });

  await test.step('places the menu in the layout footer', async () => {
    await page.goto('/design/layouts');
    await page.getByRole('main').getByRole('link', { name: 'Default layout' }).first().click();
    const frame = await canvas(page);
    await expect(frame.locator('nav.mb-menu')).toHaveCount(1);

    await page.getByRole('treeitem', { name: /^Site name Text/ }).click();
    const pane = page.getByRole('complementary', { name: 'Elements' });
    await pane.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Menu', exact: true }).click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await choose(page, inspector, 'Menu', 'Main navigation');
    await choose(page, inspector, 'Looks like', 'footer');
    await expect(frame.locator('nav.mb-menu')).toHaveCount(2);

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Default layout live/ })).toBeVisible();
  });

  await test.step('publishes the rest', async () => {
    await page.goto('/design');
    await page.getByRole('button', { name: /^Publish all/ }).click();
    await expect(page.getByRole('button', { name: 'All published' })).toBeDisabled();
  });

  const visitor = await (await browser.newContext()).newPage();

  await test.step('the site process serves the design', async () => {
    const response = await visitor.goto(`${site}/`);
    expect(response?.status()).toBe(200);
    await expect(visitor).toHaveTitle(`Home | ${SPACE.name}`);
    await expect(visitor.locator('meta[name="robots"]')).toHaveCount(0);

    // Theme tokens from the published stylesheet.
    await expect
      .poll(() =>
        visitor.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--mb-color-accent').trim(),
        ),
      )
      .toBe(ACCENT);

    // The bound, styled text in every teaser.
    const block = visitor.locator('.manablox-block').first();
    await expect(block.locator('h2')).toHaveText('Welcome to Designed Site');
    const text = block.locator('p.mb-e-text');
    await expect(text).toHaveText('Welcome to Designed Site');
    await expect(text).toHaveCSS('color', VIOLET);

    // The layout: the header menu and the footer one, both with the basic setup's pages.
    const menus = visitor.getByRole('navigation', { name: 'Main navigation' });
    await expect(menus).toHaveCount(2);
    await expect(menus.first().getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '/about',
    );
    await expect(menus.last().getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');

    // Every stylesheet and island script the page links answers.
    const assets = await visitor.evaluate(() =>
      [
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (link) => (link as HTMLLinkElement).href,
        ),
        ...[...document.querySelectorAll('script[src]')].map(
          (script) => (script as HTMLScriptElement).src,
        ),
      ].filter((href) => href.includes('/_site/')),
    );
    expect(assets.some((href) => href.includes('/_site/islands/'))).toBe(true);
    for (const href of assets) expect((await visitor.request.get(href)).status(), href).toBe(200);

    await expect(visitor.getByRole('link', { name: 'About' }).first()).toBeVisible();
    await visitor.goto(`${site}/about`);
    await expect(visitor).toHaveTitle(`About | ${SPACE.name}`);
  });

  await test.step('a form submission creates a databag record', async () => {
    await visitor.goto(`${site}/`);
    const form = visitor.locator('form.mb-e-form').first();
    await form.getByLabel('Name').fill('Ada Lovelace');
    await form.getByLabel('Message').fill('Sent from the designed site');
    // The site refuses forms sent faster than a person could fill them.
    await visitor.waitForTimeout(2_500);
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(form.getByRole('status')).toHaveText('Thank you!');

    const records = (await rpc(page, 'content/list', {
      filter: { spaceId, typeIds: [contactTypeId] },
      pagination: { limit: 10, offset: 0 },
    })) as { items: { id: string }[] };
    expect(records.items).toHaveLength(1);
    const record = (await rpc(page, 'content/get', { spaceId, id: records.items[0]?.id })) as {
      fields: Record<string, unknown>;
    };
    expect(record.fields).toMatchObject({
      name: 'Ada Lovelace',
      message: 'Sent from the designed site',
    });
  });

  await test.step('"Style this block" gives the instance its own class on the site', async () => {
    await page.goto('/content');
    await page.getByRole('link', { name: 'Home', exact: true }).first().click();
    await page.getByRole('button', { name: /^Teaser - Welcome to Designed Site/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Teaser' });
    await dialog.getByText('Style this block').click();
    await dialog.getByRole('button', { name: 'Background', exact: true }).click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Accent', exact: true })
      .click();
    // Closes the token picker, not the block dialog.
    await dialog.getByRole('heading', { name: 'Teaser' }).click();
    await choose(page, dialog, 'Text alignment', /^Center/);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('* Published')).toBeVisible();

    await visitor.goto(`${site}/`);
    const block = visitor.locator('.manablox-block').first();
    await expect(block).toHaveClass(/\bmb-i-[0-9a-z]+\b/);
    await expect(block).toHaveCSS('background-color', 'rgb(255, 0, 85)');
    await expect(block).toHaveCSS('text-align', 'center');
    // The other teaser keeps the design.
    await expect(visitor.locator('.manablox-block').last()).not.toHaveClass(/\bmb-i-/);
  });

  await test.step('a share link shows the draft, marked noindex', async () => {
    await page.getByLabel('Summary').fill('A draft only the link shows.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Share preview' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share a preview' });
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const link = new URL(await dialog.getByLabel('Preview link').inputValue());
    // The primary domain; the site listens on its own port here.
    expect(link.hostname).toBe('localhost');
    expect(link.pathname).toMatch(/^\/_manablox\/share\/[\w.-]+$/);
    await dialog.getByRole('button', { name: 'Close' }).last().click();

    const previewer = await (await browser.newContext()).newPage();
    const response = await previewer.goto(`${site}${link.pathname}`);
    expect(new URL(previewer.url()).pathname).toBe('/');
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(previewer.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(previewer.getByRole('main')).toContainText('A draft only the link shows.');

    // Everyone else still gets the published page.
    await visitor.reload();
    await expect(visitor.getByRole('main')).toContainText('Welcome to Designed Site.');
    await expect(visitor.getByRole('main')).not.toContainText('A draft only the link shows.');
    await visitor.screenshot({ path: info.outputPath('designed-site.png'), fullPage: true });
  });

  await test.step('edits the teaser body in place: bold, link, undo', async () => {
    // Still on the Home document.
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.getByText('Live preview connected')).toBeVisible();
    let frame: Frame | undefined;
    await expect
      .poll(() => {
        frame = page.frames().find((entry) => entry.url().includes('/_manablox/canvas'));
        return frame !== undefined;
      })
      .toBe(true);
    const canvasFrame = frame as Frame;
    const body = canvasFrame.locator('[data-manablox-field="components.0.body"]');
    await expect(body).toContainText('This page was created with the basic setup.');

    // The rich text editor loads on the double-click and takes the caret.
    await body.dblclick();
    await expect(body).toHaveAttribute('contenteditable', 'true');
    const toolbar = canvasFrame.getByRole('toolbar', { name: 'Text' });
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeVisible();

    // Selected through the DOM, as a mouse would: the text wraps at the frame's width.
    const select = async (text: string) => {
      await body.evaluate((element, needle) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(needle) ?? -1;
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          return;
        }
        throw new Error(`"${needle}" is not in the field`);
      }, text);
      await expect
        .poll(() => canvasFrame.evaluate(() => window.getSelection()?.toString()))
        .toBe(text);
    };

    await select('This');
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await expect(body.locator('strong')).toHaveText('This');
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // "page", linked in the toolbar's link field, then taken back with the editor's undo.
    await select('page');
    await toolbar.getByRole('button', { name: 'Link' }).click();
    await toolbar.getByRole('textbox', { name: 'Link address' }).fill('https://example.com/about');
    await toolbar.getByRole('textbox', { name: 'Link address' }).press('Enter');
    await expect(body.locator('a')).toHaveText('page');
    await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com/about');
    await page.keyboard.press('Control+z');
    await expect(body.locator('a')).toHaveCount(0);
    await expect(body.locator('strong')).toHaveText('This');

    // A click elsewhere ends the edit; the admin holds the document the editor made.
    await canvasFrame.locator('body').click({ position: { x: 2, y: 2 } });
    await expect(body).not.toHaveAttribute('contenteditable', 'true');
    await expect(body.locator('strong')).toHaveText('This');
    await page.getByRole('button', { name: 'Back to the document editor' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    const contents = (await rpc(page, 'content/list', {
      filter: { spaceId },
      pagination: { limit: 20, offset: 0 },
    })) as { items: { id: string; title: string }[] };
    const home = contents.items.find((item) => item.title === 'Home');
    const record = (await rpc(page, 'content/get', { spaceId, id: home?.id })) as {
      fields: { components: { blocks: { fields: { body: unknown } }[] } };
    };
    expect(record.fields.components.blocks[0]?.fields.body).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', text: 'This', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: ' page was created with the basic setup. Edit it, add blocks, or delete it and start over.',
            },
          ],
        },
      ],
    });
  });
});
