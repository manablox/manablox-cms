#!/usr/bin/env node
import { main } from './cli-main.js';

/** The executable; logic lives in `cli-main.ts` so tests can import it without running it. */
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`manablox-sdk: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
