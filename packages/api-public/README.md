# `@manablox/api-public`

The read-only REST API for your website, served under `/v1`. The alternative to GraphQL
if you prefer simple URLs.

It can only read published content. There is no signed-in user in it at all, so it
cannot change anything by design.

Examples of what it answers:

- `/v1/content`: a list of documents, filtered by type, parent or search text,
- `/v1/content/{id}`: one document by its id,
- `/v1/permalink/{path}`: the document at a URL path,
- `/v1/menus/{name}`: a menu,
- `/v1/redirects`: the redirects of a language, for your website's router,
- `/v1/assets/{id}`: an image or file,
- `/v1/types`: the content types of the space, which the SDK's type generator reads.

Add `?expand=author,related` to a request to include linked documents in the answer.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `publicRouter`: all REST endpoints. `PublicRouter` is its type.
- `PublicContext`: what each request can use: the space it serves, the database access, media and menus.
- `serializeContent`, `serializeContents`, `serializeAsset`: turn database rows into the JSON the API returns.
- `parseExpand(value)`: reads the `?expand=` parameter.
