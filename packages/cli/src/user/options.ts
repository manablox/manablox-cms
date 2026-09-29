import { MIN_PASSWORD_LENGTH } from '@manablox/auth';
import { oneOf, validEmail } from '../args.js';

type UserRole = 'superadmin' | 'editor';

/** What `manablox user create` writes; the password comes from the environment or a prompt. */
export interface UserOptions {
  email: string;
  name: string;
  /** The first account is a superadmin whatever this says. */
  role: UserRole;
}

/** Read by `manablox user create`, so the password never shows in a command line. */
export const PASSWORD_ENV = 'MANABLOX_USER_PASSWORD';

export function validPassword(value: string): string {
  if (value.length < MIN_PASSWORD_LENGTH || value.length > 200) {
    throw new Error(`the password needs ${MIN_PASSWORD_LENGTH} to 200 characters`);
  }
  return value;
}

export function validUserName(option: string, value: string): string {
  const name = value.trim();
  if (!name || name.length > 200)
    throw new Error(`--${option} needs a name of 1 to 200 characters`);
  return name;
}

/** `manablox user create` options; the email is required. */
export function userOptionsFromArgs(options: Record<string, string>): UserOptions {
  if (options.email === undefined) throw new Error('--email is required; see manablox --help');
  const email = validEmail('email', options.email.trim().toLowerCase());
  return {
    email,
    name: validUserName('name', options.name ?? 'Administrator'),
    role: oneOf('role', options.role ?? 'superadmin', ['superadmin', 'editor']),
  };
}

/** The arguments of `manablox user create` for these options. */
export function userCreateArgs(user: Pick<UserOptions, 'email' | 'name'>): string[] {
  return ['user', 'create', '--email', user.email, '--name', user.name];
}
