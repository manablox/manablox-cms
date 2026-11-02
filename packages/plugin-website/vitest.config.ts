import { graphqlTestConfig, pluginTestConfig } from '@manablox/config-vitest';

// graphql comes via api-graphql.
export default pluginTestConfig(graphqlTestConfig(import.meta.url, '@manablox/api-graphql'));
