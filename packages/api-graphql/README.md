# `@manablox/api-graphql`

The GraphQL API for reading content.

The GraphQL schema is built from your content types while the server runs. So a content
type `post` becomes a real GraphQL type `Post` with its own fields, and changes to your
content types show up without a restart.

It also protects a public server:

- linked documents are loaded in batches, so one query never turns into hundreds of database calls,
- very deep or very expensive queries are refused,
- optional persisted queries allow only queries you registered before,
- answers are cached and cleared exactly when a document they used is published.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `createGraphQLServer(options)`: the GraphQL endpoint, built with GraphQL Yoga.
- `buildSchema(manablox)`: builds the schema from the registered content types.
- `SchemaCache`: keeps the built schema and rebuilds it when a content type changes.
- `depthLimitPlugin(max)`: refuses queries nested deeper than `max`.
- `complexityLimitPlugin(max)`: refuses queries that would load too much.
- `persistedOperationsPlugin(options)`: only allows queries from a list you provide.
- `disableIntrospectionPlugin()`: hides the schema from strangers.
- `responseCachePlugin(options)`: caches answers and clears them when content changes.
