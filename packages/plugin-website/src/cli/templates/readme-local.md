## Designed sites

A space can be designed in the admin (Design in the sidebar) instead of feeding a frontend of
your own. The site process renders those spaces as websites: start it in another terminal
with `pnpm dev:site` (`pnpm start:site` without the restarts), it listens at <__SITE_URL__>
and reads `manablox.site.config.ts`. It picks the space by the domain a visitor asks for, so
add the domain `localhost` to the space under Design, Domains, publish, and open
<__SITE_URL__>. The admin frames the same process (`SITE_URL`) for the design canvas.

Forms on a designed site create databag entries through the management API. Both processes
read `SITE_FORMS_SECRET` from `.env`, which was generated for you; forms answer "not
available" while it is empty.
