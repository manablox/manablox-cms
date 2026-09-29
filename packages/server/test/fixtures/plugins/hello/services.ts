import {
  auditor,
  controlKeys,
  type PluginControls,
  type PluginServicesContext,
  pluginError,
  type Scope,
  scopeSpaceId,
} from '@manablox/core';
import type { Repositories } from '@manablox/db';
import { type HelloGreetingRow, helloRepos } from './db.js';

declare module '@manablox/core' {
  /** Other plugins reach the greetings with `plugins.get('hello')`. */
  interface PluginServicesMap {
    hello: HelloServices;
  }
}

/** A feature for greetings in capitals, and a limit on greetings, counted by `helloData`. */
export const helloControls = {
  'features.plugins.hello.shout': {
    label: 'Shouted greetings',
    description: 'Greetings written in capitals.',
  },
  'limits.plugins.hello.greetings': {
    label: 'Greetings',
    description: 'Greetings, staging ones included.',
    nouns: ['greeting', 'greetings'],
  },
} satisfies PluginControls;

export const helloKeys = controlKeys('hello', helloControls);

/** A greeting in capitals. */
export const shouted = (message: string) =>
  /[A-Z]/.test(message) && message === message.toUpperCase();

/** Greetings with the plugin's feature, limit and audit trail. */
export class GreetingService {
  constructor(private readonly context: PluginServicesContext) {}

  list(scope: Scope): Promise<HelloGreetingRow[]> {
    return helloRepos(this.context.repos).greetings.list(scope);
  }

  /** In production when `scope` is a space id. */
  async create(scope: Scope, message: string): Promise<HelloGreetingRow> {
    const { controls } = this.context.manablox;
    const spaceId = scopeSpaceId(scope);
    if (shouted(message) && !(await controls.feature(spaceId, helloKeys.features.shout)).enabled) {
      throw pluginError('plugins.hello.shoutingOff');
    }
    await controls.assertLimit(scope, helloKeys.limits.greetings);
    return this.context.repos.transaction(async (tx: Repositories) => {
      const target = typeof scope === 'string' ? { spaceId } : scope;
      const row = await helloRepos(tx).greetings.create(target, message);
      await auditor(tx, 'hello.greeting', (greeting: HelloGreetingRow) => greeting.message).record(
        'hello.greeting.create',
        row,
      );
      return row;
    });
  }
}

/** A change to a space's environments, as `onLiveChange` reported it. */
export interface HelloLiveChange {
  spaceId: string;
  reason: string;
}

/** The plugin's services, built once per process. */
export function helloServices(context: PluginServicesContext) {
  return {
    greetings: new GreetingService(context),
    /** The environment changes this process was told about, newest last. */
    live: [] as HelloLiveChange[],
  };
}

export type HelloServices = ReturnType<typeof helloServices>;
