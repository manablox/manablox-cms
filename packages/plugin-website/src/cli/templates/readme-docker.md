## Designed sites

The website plugin adds `manablox.site.config.ts` and the `site` service, which runs it:
the designed sites of every space, by domain, {{#if sqlite}}with read-only surfaces{{#else}}connected as the read-only database role{{/if}}{{#if byDomain}}.{{#else}},
on host port `$SITE_PORT`.{{/if}}

A space switched to a designed site in the admin is served by `site` on every domain
added to it there (Design, Domains). Point the domain's DNS at this host.{{#if caddy}} Caddy asks
`site` at `/_manablox/domain-check` whether it knows the domain and then fetches its
certificate on the first request, so no Caddyfile change is needed per domain.{{/if}}{{#if nginx}} nginx sends
every host it does not know to `site` over plain http; add a server block with a
domain's certificate to serve it over https.{{/if}}{{#if ports}} Your proxy sends those
domains to host port `$SITE_PORT`.{{/if}}

Set `SITE_URL` in `.env` to one of those origins so the admin can frame the site for the
design canvas, then `docker compose up -d api site`.

Forms on a designed site create databag entries through `api`. `SITE_FORMS_SECRET` in
`.env` (generated for you, read by both services) switches them on; `site` posts to
`http://api:3000/plugins/website/forms/submit` over the compose network{{#if byDomain}}, and {{#if caddy}}Caddy{{#else}}nginx{{/if}} refuses
`/plugins/website/forms/*` from outside{{/if}}.
