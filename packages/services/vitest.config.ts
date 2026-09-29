import { sharedConfig } from '@manablox/config-vitest';
import { mergeConfig } from 'vitest/config';

// Suites seed a real database; a loaded machine needs the headroom.
export default mergeConfig(sharedConfig, { test: { testTimeout: 60_000 } });
