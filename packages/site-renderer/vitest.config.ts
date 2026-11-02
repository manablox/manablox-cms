import { sharedConfig } from '@manablox/config-vitest';

// SSR tests run in Node; island and canvas tests opt into happy-dom per file.
export default sharedConfig;
