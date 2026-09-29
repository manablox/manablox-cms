import { graphqlTestConfig } from '@manablox/config-vitest';

// graphql comes via api-graphql.
export default graphqlTestConfig(import.meta.url, '@manablox/api-graphql');
