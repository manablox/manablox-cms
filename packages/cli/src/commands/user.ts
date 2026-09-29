import type { Repositories } from '@manablox/db';
import type { ParsedArgs } from '../args.js';

/** `manablox user create`: an account that signs in with email and password. */
export async function user(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0];
  if (action !== 'create') {
    process.stderr.write(
      `manablox: ${action ? `unknown user action '${action}'` : 'user needs an action'}; try manablox user create --email <email>\n`,
    );
    return 1;
  }

  const { PASSWORD_ENV, userOptionsFromArgs, validPassword } = await import('../user/options.js');
  const options = userOptionsFromArgs(args.options);
  const password = await readPassword(PASSWORD_ENV, validPassword);
  if (password === null) {
    process.stderr.write(
      `manablox: no password; set ${PASSWORD_ENV} or run this in a terminal to be asked\n`,
    );
    return 1;
  }

  const { bootstrap, loadConfig, requireManagement } = await import('@manablox/server');
  const { config } = await loadConfig(args.options.config);
  const runtime = requireManagement(
    await bootstrap({ ...config, server: { ...config.server, mode: 'management' } }),
  );

  try {
    // Idempotent, so a setup script can run it again.
    if (await findUserId(runtime.repos, options.email)) {
      process.stdout.write(
        `manablox: the account ${options.email} exists already; nothing was created\n`,
      );
      return 0;
    }
    // The first account runs the instance, as when it signs up in the admin.
    const first = (await runtime.repos.users.count()) === 0;
    const created = await runtime.users.create({
      ...options,
      password,
      role: first ? 'superadmin' : options.role,
    });
    if (first) {
      const { ownEverySpace } = await import('@manablox/auth');
      await ownEverySpace(runtime.manablox, runtime.repos, created.id);
    }
    process.stdout.write(`manablox: created the ${created.role} ${created.email}\n`);
    return 0;
  } finally {
    await runtime.shutdown();
  }
}

/** The account with exactly this (normalised) email. */
export async function findUserId(
  repos: Pick<Repositories, 'users'>,
  email: string,
): Promise<string | null> {
  const wanted = email.trim().toLowerCase();
  const { items } = await repos.users.page({ limit: 50, offset: 0 }, wanted);
  return items.find((row) => row.email.toLowerCase() === wanted)?.id ?? null;
}

/** From the environment, else asked twice in a terminal; `null` without either. */
async function readPassword(env: string, valid: (value: string) => string): Promise<string | null> {
  const given = process.env[env];
  if (given) return valid(given);
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return null;

  const { clackUi, validateWith } = await import('../ui.js');
  const ui = clackUi();
  const password = await ui.password({ message: 'Password', validate: validateWith(valid) });
  await ui.password({
    message: 'Repeat the password',
    validate: (value) => (value === password ? undefined : 'the passwords differ'),
  });
  return password;
}
