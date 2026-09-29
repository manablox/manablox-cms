import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../scaffold.js';
import { spaceCreateArgs } from '../space/options.js';
import type { Reporter } from '../ui.js';
import { PASSWORD_ENV, userCreateArgs } from '../user/options.js';
import { type CreateOptions, firstSpace } from './options.js';
import { nginxUsesTls } from './templates.js';

/** One command of the start sequence. */
export interface StartStep {
  label: string;
  done: string;
  command: string;
  args: string[];
  /** Extra environment, for values that must not show in the command line. */
  env?: Record<string, string>;
}

/** Commands that start a fresh instance, in order; for the local preset `pnpm dev` runs afterwards. */
export function startSteps(options: CreateOptions, dir: string): StartStep[] {
  const [adminBin = 'pnpm', ...adminArgs] = adminCommand(options, true);
  const [spaceBin = 'pnpm', ...spaceArgs] = spaceCommand(options);
  // The account first, so it can own the space.
  const setup: StartStep[] = [
    ...(options.admin
      ? [
          {
            label: `Creating the administrator ${options.adminEmail}`,
            done: `Administrator ${options.adminEmail} created`,
            command: adminBin,
            args: adminArgs,
            env: { [PASSWORD_ENV]: options.adminPassword },
          },
        ]
      : []),
    ...(options.space
      ? [
          {
            label: `Creating the space ${options.spaceName}`,
            done: `Space ${options.spaceName} created`,
            command: spaceBin,
            args: spaceArgs,
          },
        ]
      : []),
  ];
  if (options.preset === 'local') {
    return [
      {
        label: 'Starting the services',
        done: 'Services are up and healthy',
        command: 'docker',
        args: ['compose', 'up', '-d', '--wait'],
      },
      {
        label: 'Applying the migrations',
        done: 'Migrations applied',
        command: 'pnpm',
        args: ['migrate'],
      },
      ...setup,
    ];
  }

  const steps: StartStep[] = [];
  // nginx will not start without a certificate; a self-signed one stands in.
  if (
    options.proxy === 'nginx' &&
    nginxUsesTls(options) &&
    !existsSync(join(dir, 'nginx', 'certs', 'fullchain.pem'))
  ) {
    steps.push({
      label: 'Writing a self-signed certificate for nginx',
      done: 'Self-signed certificate written to nginx/certs/',
      command: './scripts/selfsigned-certs.sh',
      args: [],
    });
  }
  steps.push({
    label: 'Building the image and starting the stack (the first build takes a few minutes)',
    done: 'The stack is up',
    command: 'docker',
    args: ['compose', 'up', '-d', '--build'],
  });
  return [...steps, ...setup];
}

/**
 * `manablox user create` for the administrator. `passEnv` hands the password to the Docker
 * container; without it the command asks for one.
 */
export function adminCommand(options: CreateOptions, passEnv = false): string[] {
  const args = userCreateArgs({ email: options.adminEmail, name: options.adminName });
  return options.preset === 'docker'
    ? [
        'docker',
        'compose',
        'run',
        '--rm',
        ...(passEnv ? ['-e', PASSWORD_ENV] : []),
        'migrate',
        ...args,
      ]
    : ['pnpm', 'exec', 'manablox', ...args];
}

/** `manablox space create` for the first space; in Docker through the one-shot migrate container. */
export function spaceCommand(options: CreateOptions): string[] {
  const args = spaceCreateArgs(firstSpace(options));
  return options.preset === 'docker'
    ? ['docker', 'compose', 'run', '--rm', 'migrate', ...args]
    : ['pnpm', 'exec', 'manablox', ...args];
}

/** Stops at the first failing step and warns with its output. */
export async function runStartSteps(
  steps: StartStep[],
  dir: string,
  reporter: Reporter,
): Promise<boolean> {
  for (const step of steps) {
    const shown = [step.command, ...step.args].join(' ');
    const exit = await reporter.spin(
      step.label,
      () => runCommand(step.command, step.args, dir, step.env),
      (result) => (result.code === 0 ? step.done : `${shown} exited with ${result.code}`),
    );
    if (exit.code !== 0) {
      reporter.warn(
        `The instance was not started; fix the cause and run the next steps yourself\n${exit.output.trim()}`,
      );
      return false;
    }
  }
  return true;
}
