/**
 * `@manablox/plugin-license/cli`: the license plugin's part of the `manablox` CLI. The help
 * imports this module, so it only describes; the commands and templates load when they run.
 */
import type { CliContribution, CliOption } from '@manablox/core';

const BROWSER: CliOption = {
  name: 'browser',
  type: 'switch',
  help: '--no-browser only prints the address; the default without a terminal or over SSH',
};
const ACTIVATE: CliOption = {
  name: 'activate',
  type: 'switch',
  help: '--no-activate only writes the key to .env; the instance activates it when it starts',
};
const DEV: CliOption = {
  name: 'dev',
  type: 'switch',
  help: 'activate as development: no seat, private hostnames only',
};
const PRODUCTION: CliOption = {
  name: 'production',
  type: 'switch',
  help: 'activate as production, taking a seat (default: decided by the hostnames)',
};

const commands = () => import('./commands.js');

const contribution: CliContribution = {
  summary: 'License keys for the premium plugins',
  commands: {
    buy: {
      description: 'Buy a subscription in the browser; the key is added and activated here',
      options: [
        { name: 'plugins', arg: 'ai,website', help: 'the premium plugins; both is the bundle' },
        { name: 'yearly', type: 'switch', help: 'bill yearly' },
        { name: 'monthly', type: 'switch', help: 'bill monthly' },
        {
          name: 'trial',
          type: 'switch',
          help: 'ask for the 14-day trial; the portal checks it is still free',
        },
        BROWSER,
        ACTIVATE,
      ],
      run: async (context) => (await commands()).buy(context),
    },
    add: {
      description: 'Add a key to MANABLOX_LICENSE_KEYS in .env and activate it',
      args: '<key>',
      options: [
        DEV,
        PRODUCTION,
        { name: 'name', arg: '<name>', help: 'the instance name the portal shows' },
        ACTIVATE,
      ],
      run: async (context) => (await commands()).add(context),
    },
    status: {
      description: 'Every key and product of the instance; exit code 1 while a product is locked',
      options: [{ name: 'json', type: 'switch', help: 'print the overview as JSON' }],
      run: async (context) => (await commands()).status(context),
    },
    activate: {
      description: 'Activate keys again, e.g. after a conflict or a restore',
      args: '[<keyId>]',
      options: [DEV, PRODUCTION],
      run: async (context) => (await commands()).activate(context),
    },
    refresh: {
      description: 'Refresh every lease now',
      run: async (context) => (await commands()).refresh(context),
    },
    remove: {
      description: 'Deactivate a key and take it out of .env (or the database)',
      args: '<keyId>',
      run: async (context) => (await commands()).remove(context),
    },
    open: {
      description: 'Open the portal: the subscriptions, or with billing the account',
      args: '[billing]',
      options: [BROWSER],
      run: async (context) => (await commands()).open(context),
    },
  },
  templates: async (context) => (await import('./templates.js')).licenseTemplates(context),
};

export default contribution;
