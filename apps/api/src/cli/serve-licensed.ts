// The API with a test license: the license plugin grants itself a lease for the premium
// products, signed with a test key pair: the one `MANABLOX_TEST_LICENSE_SIGNING` carries
// (`signingToEnv`), so other processes of the instance can trust the same pair, else one
// generated at startup that only this process trusts. For the admin e2e and for working on
// licensing without a license server; never for a real instance.

import {
  generateTestSigningKeys,
  signingFromEnv,
  TEST_LICENSE_SIGNING_ENV,
  testLicensePlugin,
} from '@manablox/plugin-license/testing';
import { run } from '@manablox/server';
import { config } from '../config.js';

const signing = process.env[TEST_LICENSE_SIGNING_ENV]
  ? signingFromEnv()
  : generateTestSigningKeys();
const plugins = (config.plugins ?? []).map((plugin) =>
  plugin.name === 'license' ? testLicensePlugin({ signing }) : plugin,
);

await run({ ...config, plugins }, { label: 'manablox api (test license)' });
