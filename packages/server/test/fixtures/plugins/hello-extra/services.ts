import type { PluginChannel, PluginContext, PluginServicesContext } from '@manablox/core';
// For `plugins.get('hello')`, typed by the hello fixture's augmentation.
import type {} from '../hello/services.js';

declare module '@manablox/core' {
  /** `plugins.get('hello-extra')` in other plugins. */
  interface PluginServicesMap {
    'hello-extra': HelloExtraServices;
  }
  /** Entries others contribute to this plugin's points. */
  interface PluginContributions {
    'hello-extra': { greeters: Greeter };
  }
}

/** A word the board greets with; other plugins contribute them to `greeters`. */
export interface Greeter {
  word: string;
}

/** What the board tells the instance's other processes. */
export interface BoardMessage {
  spaceId: string;
}

/** The greeting board: words from every plugin that contributes, and a channel between processes. */
export class GreetingBoard {
  /** Set by `start`, cleared by `stop`. */
  started = false;
  /** Board messages other processes sent, newest last; `null` after a reconnect. */
  readonly heard: Array<BoardMessage | null> = [];
  private channel: PluginChannel<BoardMessage> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly context: PluginServicesContext) {}

  /** The words of the plugins that are on in the space, each with its plugin. */
  async words(spaceId: string): Promise<string[]> {
    const entries = await this.context.plugin.contributions<Greeter>('greeters', spaceId);
    return entries.map(({ plugin: from, entry }) => `${entry.word} (${from})`);
  }

  /** The space's greetings, through the hello plugin's services. */
  async greetings(spaceId: string): Promise<number | null> {
    const hello = this.context.plugin.plugins.get('hello');
    return hello ? (await hello.greetings.list(spaceId)).length : null;
  }

  /** Listens on the board channel; `start` calls it. */
  listen(plugin: PluginContext): void {
    this.channel = plugin.channel<BoardMessage>('board');
    this.unsubscribe = this.channel.subscribe((message) => this.heard.push(message ?? null));
    this.started = true;
  }

  /** Stops listening; `stop` calls it. */
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
  }

  /** Tells the other processes that the space's board changed. */
  announce(spaceId: string): void {
    this.channel?.publish({ spaceId });
  }
}

/** The plugin's services, built once per process. */
export function helloExtraServices(context: PluginServicesContext) {
  return { board: new GreetingBoard(context) };
}

export type HelloExtraServices = ReturnType<typeof helloExtraServices>;
