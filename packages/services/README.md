# `@manablox/services`

The rules of the CMS. Every change, like saving, publishing or deleting a document, goes
through a service. The service:

- checks the input against the content type and its fields (also inside blocks),
- checks that the user has the needed permission, down to single fields,
- handles languages (locales) and versions,
- runs the hooks that plugins registered,
- saves to the database and clears the cache.

The APIs (`api-rpc`, `api-graphql`, `api-public`) only check the input format and then
call a service.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `ContentService`: create, read, update, publish, unpublish and delete documents.
- `ContentTypeService`: create and change content types and block types.
- `SpaceService`: create spaces and manage their members.
- `MenuService`: navigation menus.
- `RedirectService`: redirects from old paths to new ones, added by hand or when a page's address changes.
- `RoleService`: roles and their permissions.
- `ApprovalService`: documents that need someone's approval before they go live.
- `ScheduleService`: publish and unpublish at a set time.
- `NotificationService`, `AuditService`: notifications for users (in the admin, by email and by browser push) and the log of who changed what.
- `createMailer(...)`, `createPusher(...)`: send emails and push notifications. `generatePushKeys()` creates push keys.
- `createLoaders()`: loads related documents, assets and users in batches, so a list of 50 posts does not cause 50 extra queries.
- `toPublicListQuery()`: turns the filters of a public API request into a database query, the same way for GraphQL and REST.

## For tests

`@manablox/services/testing` builds the services over a test database from
`@manablox/db/testing`: `createServiceContext(name, { config })` gives a suite a fresh
database with one space and the whole service layer, hooks wired as in the server.
`withControls()` sets feature switches and limits at a scope and returns a restore;
`spaceGroup()` makes a space group to scope them to.
