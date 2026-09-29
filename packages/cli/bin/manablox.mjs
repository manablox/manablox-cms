#!/usr/bin/env node
// tsx loads the project's `manablox.config.ts`, which may use syntax Node's type stripping does not cover.
import { register } from 'tsx/esm/api';

register();

const { main } = await import('@manablox/cli');

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    // A refusal of the core names its key; its params say what it is about.
    const params = error?.details?.[0]?.params;
    const about = params ? ` ${JSON.stringify(params)}` : '';
    process.stderr.write(`manablox: ${error instanceof Error ? error.message : error}${about}\n`);
    process.exitCode = 1;
  });
