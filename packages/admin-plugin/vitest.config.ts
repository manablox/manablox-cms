import { sharedConfig } from '@manablox/config-vitest';
import { mergeConfig } from 'vitest/config';

// Vite's native resolver rejects RegExps from a `vmThreads` context.
export default mergeConfig(sharedConfig, { test: { pool: 'threads' } });
