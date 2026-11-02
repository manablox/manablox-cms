# `@manablox/site-app`

The site process, the `website` mode of the website plugin
(`@manablox/plugin-website`), and what the site image (`ghcr.io/manablox/site`) runs. It
shows every space that was switched to a **designed site** in the admin as a finished
website: it picks the space by the domain a visitor opens (the space's domains under
**Settings > API hosts**), renders the page with the published designs and content, and
caches the HTML.

`src/config.ts` calls the plugin's `websiteProcessConfig()` and `src/main.ts` its
`runWebsite(config)` (`run(config, { mode: 'website' })`):

- the `website` mode mounts the pages and `/media` and nothing else: no login, no API, no uploads
- masked errors and a rate limit keyed by IP address (1200 requests a minute, `RATE_LIMIT=off` turns it off)
- the plugin's `editorOrigin`, the admin origin allowed to show the design canvas
- the plugin's `forms`, which forwards form submissions to the management API

Like the public API it only reads, so it can use a read-only database role.

## Run it

In the dev stack it starts with everything else (`pnpm dev:up`) at <http://localhost:3003>.
To see a site, switch a space to a designed site in the admin (<http://localhost:3002>) and
add the domain `localhost` under **Settings > API hosts**.

The dev stack's `site` service loads `apps/api/.env` (database, cache, storage,
`AUTH_SECRET` and `SITE_FORMS_SECRET`), then `apps/site/.env` for what differs
(`scripts/dev.sh` copies both from their `.env.example` the first time).

The variables it reads besides the usual database, cache, storage and logging ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3200` | Port |
| `PUBLIC_URL` | `http://localhost:3200` | Where the site process is reached |
| `SITE_EDITOR_ORIGIN` | none | The admin origin, for example `http://localhost:3002`. Without it the design canvas is not served |
| `CACHE_TTL` | `300` | Seconds a page is cached |
| `SITE_FORMS_API_URL` | none | The management API, for form submissions |
| `SITE_FORMS_SECRET` | none | The same secret as the management API's. Forms are off unless both forms variables are set |
| `AUTH_SECRET` | required | The management API's secret: it checks share links |

The management API needs `SITE_URL` set to where this process answers, so the admin knows
where to find the canvas.

## The image

`pnpm docker:build site` builds `ghcr.io/manablox/site:<version>` from `docker/Dockerfile.site`;
it runs `node apps/site/dist/main.js` on port 3200 and reports health on `/readyz`. It
needs the instance's database (migrated by the management API), storage, cache and the
variables above:

```sh
docker run -p 3200:3200 \
  -e DATABASE_URL=postgres://... -e REDIS_URL=redis://... -e AUTH_SECRET=... \
  -e SITE_EDITOR_ORIGIN=https://cms.example.com \
  -e SITE_FORMS_API_URL=http://api:3000 -e SITE_FORMS_SECRET=... \
  ghcr.io/manablox/site:0.50.0
```

How to configure it, get HTTPS for every domain and scale it is in the developer
documentation, [Designed sites](https://dev.manablox.io/site/).
