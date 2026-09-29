#!/usr/bin/env node
// vue-tsc drives TypeScript's programmatic API, which the native 7.x compiler does not
// expose. A project that compiles with TypeScript 7 type-checks its `.vue` files with the
// vue-tsc and TypeScript 5.9 this package installs, resolved from here rather than from the
// project. vue-tsc reads the arguments from `process.argv` and exits with tsc's code.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

require('vue-tsc').run(require.resolve('typescript/lib/tsc'));
