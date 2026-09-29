import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * One server for both modes. In development it creates Vite in middleware mode, so
 * `/src/...` is served with hot reload and the server entry is compiled on the fly; in
 * production it serves the built client bundle and imports the built server entry once.
 */
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? __PORT__);
const root = import.meta.dirname;

/**
 * Configuration the site needs. Read on the server, at start-up, and handed to the
 * browser inside the page, so one build runs against any instance.
 */
const config = {
  url: process.env.MANABLOX_URL ?? '__MANABLOX_URL__',
  editorOrigin: process.env.MANABLOX_ADMIN_ORIGIN ?? '__EDITOR_ORIGIN__',
  spaceId: process.env.MANABLOX_SPACE_ID ?? '',
};

const app = express();

let vite;
if (isProduction) {
  // Hashed assets are immutable; index.html is never served from here, so `index: false`.
  app.use(
    '/assets',
    express.static(path.join(root, 'dist/client/assets'), { immutable: true, maxAge: '1y' }),
  );
  app.use(express.static(path.join(root, 'dist/client'), { index: false }));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
}

app.use('*all', async (req, res) => {
  const url = req.originalUrl;
  try {
    let template;
    let render;
    if (vite) {
      template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      template = await vite.transformIndexHtml(url, template);
      ({ render } = await vite.ssrLoadModule('__SERVER_ENTRY__'));
    } else {
      template = fs.readFileSync(path.join(root, 'dist/client/index.html'), 'utf8');
      ({ render } = await import('./dist/server/entry-server.js'));
    }

    const { html, head, status } = await render(url, config);
    res
      .status(status)
      .set({
        'content-type': 'text/html',
        // Delivery responses are purged on publish, so a CDN may hold a page briefly;
        // a page that could not be rendered must not be held at all.
        'cache-control': status >= 500 ? 'no-store' : 'public, max-age=0, s-maxage=300',
      })
      .end(template.replace('<!--app-head-->', head).replace('<!--app-html-->', html));
  } catch (error) {
    vite?.ssrFixStacktrace(error);
    console.error(error);
    // "The CMS is down" is a 503, never a 404.
    res.status(503).set('cache-control', 'no-store').end('Something went wrong.');
  }
});

app.listen(port, () => console.log(`http://localhost:${port}`));
