import { spawn as spawnProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** What `openUrl` looks at; tests hand in their own. */
export interface OpenEnvironment {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether stdout is a terminal. */
  tty: boolean;
  /** The contents of `/proc/version`, `''` where there is none. */
  procVersion: () => string;
  /** Whether a command is on the `PATH`. */
  onPath: (command: string) => boolean;
  /** Starts the browser; errors arrive as the child's `error` event. */
  spawn: (
    command: string,
    args: string[],
  ) => { on(event: 'error', listener: () => void): unknown; unref(): void };
}

/** The platform's command that opens a URL in the default browser. */
export function browserCommand(
  url: string,
  environment: Pick<OpenEnvironment, 'platform' | 'procVersion' | 'onPath'>,
): [command: string, args: string[]] {
  if (environment.platform === 'darwin') return ['open', [url]];
  // `start` is a cmd builtin whose first quoted argument is the window title: the empty
  // argument goes out as `""`. cmd splits commands at `&` unless it is escaped.
  const start = ['/c', 'start', '', url.replace(/&/g, '^&')];
  if (environment.platform === 'win32') return ['cmd', start];
  if (/microsoft/i.test(environment.procVersion())) {
    return environment.onPath('wslview') ? ['wslview', [url]] : ['cmd.exe', start];
  }
  return ['xdg-open', [url]];
}

/** Why the browser stays closed: `--no-browser`, no terminal, or a session over SSH. */
function noBrowser(browser: boolean, environment: OpenEnvironment): string | null {
  if (!browser) return 'no-browser';
  if (!environment.tty) return 'no terminal';
  if (environment.env.SSH_CONNECTION) return 'SSH';
  return null;
}

function defaultEnvironment(): OpenEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    tty: process.stdout.isTTY === true,
    procVersion: () => {
      try {
        return readFileSync('/proc/version', 'utf8');
      } catch {
        return '';
      }
    },
    onPath: (command) =>
      (process.env.PATH ?? '')
        .split(delimiter)
        .some((dir) => dir !== '' && existsSync(join(dir, command))),
    spawn: (command, args) =>
      spawnProcess(command, args, { detached: true, stdio: 'ignore', windowsHide: true }),
  };
}

/**
 * Prints `url` and opens it in the browser, detached. Only prints with `browser: false`,
 * without a terminal and over SSH. Never throws: a browser that does not start leaves the
 * printed address.
 */
export async function openUrl(
  url: string,
  options: {
    out: { write(text: string): unknown };
    browser?: boolean;
    environment?: Partial<OpenEnvironment>;
  },
): Promise<boolean> {
  const environment = { ...defaultEnvironment(), ...options.environment };
  const skipped = noBrowser(options.browser ?? true, environment);
  if (skipped) {
    options.out.write(`Open this address in a browser:\n  ${url}\n`);
    return false;
  }
  options.out.write(`Opening ${url}\n`);
  try {
    const [command, args] = browserCommand(url, environment);
    const child = environment.spawn(command, args);
    const opened = await new Promise<boolean>((resolve) => {
      child.on('error', () => resolve(false));
      // A spawn failure is reported on the next ticks; after that the browser is on its way.
      setTimeout(() => resolve(true), 200).unref();
    });
    child.unref();
    if (!opened) options.out.write(`No browser opened; open the address yourself:\n  ${url}\n`);
    return opened;
  } catch {
    options.out.write(`No browser opened; open the address yourself:\n  ${url}\n`);
    return false;
  }
}
