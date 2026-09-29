import { sharedConfig } from '@manablox/config-vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(sharedConfig, defineConfig({ test: { setupFiles: ['test/setup.ts'] } }));
