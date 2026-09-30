# Changelog

All `@manablox/*` packages of this repository share one version number and are released
together.

## 0.50.0 - unreleased

The first release from this repository. Manablox is a headless CMS that can be run for other
people: every feature can be switched on or off and every resource limited from the outside,
so a hosting or billing system can offer it in plans.

### Highlights

- **Content your way.** Content types in `manablox.config.ts` or built in the admin, with
  field types from text to repeaters, databags and redirects. A management
  API (oRPC), a GraphQL and a REST delivery API, and SDKs for any frontend, with live preview
  and a Nuxt module.
- **Postgres or SQLite.** The same repositories on both; `manablox migrate-db` copies a
  growing SQLite instance into Postgres, links and history included. On Postgres the CMS
  runs with an account that cannot change the tables or rewrite the audit log, while a
  separate account runs the migrations.
- **Run Manablox for your customers.** A control API lets a hosting panel or billing system
  switch features, set limits (spaces, seats, documents, storage and more), cap monthly
  usage, set rate limits and retention, show banners in the admin, make an instance
  read-only or suspend it, and create the first account.
- **Usage you can bill.** API requests, bandwidth, workflow runs, form submissions, mails and
  uploads are counted per space and month, with warnings when a limit is near.
- **Accounts for teams.** Invitations by email, two-factor sign-in with backup codes,
  single sign-on over OpenID Connect or SAML, and password reset by email.
- **Staging environments and snapshots.** Copy a space into staging, change the model and the
  content there, see what would change and promote it in one step; snapshots by hand or
  every day, restored next to the original or in its place.
- **One public API for many spaces.** Each space can have its own API host name.
- **Plugins that feel built in.** Plugins bring their own admin screens, menus and settings
  without rebuilding the admin, and their own tables, permissions, switches and limits, API,
  jobs, server processes and command line options. They take part in staging copies,
  exports, snapshots and usage. Workflows and webhooks are plugins in this repository.
- **Pick your features.** `manablox create` asks which features a new project gets, and
  `manablox plugin install`, `uninstall`, `enable` and `disable` change them later. The
  premium plugins, AI and the website designer, install from npm by name.
- **License keys for the premium plugins.** `@manablox/plugin-license` activates keys,
  keeps signed leases and unlocks what they pay for. Development instances (private hosts,
  not `NODE_ENV=production`) run the premium plugins without a key; production needs a
  subscription.
- **Tools for plugin authors.** `manablox docs generate` writes the error, HTTP API and hooks
  reference for an instance with its plugins. `@manablox/db/testing`,
  `@manablox/services/testing`, `@manablox/core/testing` and `@manablox/plugin-license/testing`
  give a plugin's tests fresh databases, a service layer and a test license;
  `@manablox/admin-sdk/testing` a mocked API, an account and a space for its admin tests, and
  `@manablox/config-vitest` the shared vitest settings.
- **Licensing.** Everything in this repository is MIT, `@manablox/plugin-license` included.
  The premium plugins are under their own commercial license.
