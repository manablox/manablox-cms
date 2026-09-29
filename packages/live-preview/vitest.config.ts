import { sharedConfig } from '@manablox/config-vitest';
import { mergeConfig } from 'vitest/config';

// The channel tests need a DOM.
export default mergeConfig(sharedConfig, { test: { environment: 'happy-dom' } });
