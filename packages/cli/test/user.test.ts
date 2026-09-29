import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { defaultOptions, optionsFromArgs } from '../src/create/index.js';
import { askMissing } from '../src/create/prompts.js';
import { spaceCreateArgs, spaceOptionsFromArgs } from '../src/space/options.js';
import { userOptionsFromArgs, validPassword } from '../src/user/options.js';
import { scriptedPrompter } from './helpers/scripted-prompter.js';

describe('manablox user create', () => {
  it('takes the email, name and role; the password never comes from an option', () => {
    const args = parseArgs(['user', 'create', '--email', ' Ops@Acme.test ', '--name', 'Ops']);
    expect(args.positionals).toEqual(['create']);
    expect(userOptionsFromArgs(args.options)).toEqual({
      email: 'ops@acme.test',
      name: 'Ops',
      role: 'superadmin',
    });
    expect(() => parseArgs(['user', 'create', '--password', 'x'])).toThrow(
      /unknown option '--password'/,
    );
    expect(() => userOptionsFromArgs({})).toThrow(/--email is required/);
    expect(() => userOptionsFromArgs({ email: 'a@b.test', role: 'root' })).toThrow(/--role/);
    expect(() => validPassword('short')).toThrow(/12 to 200 characters/);
  });

  it('lets a space name its owner by email', () => {
    const space = spaceOptionsFromArgs({ name: 'Blog', owner: 'Ops@Acme.test' }, {});
    expect(space.owner).toBe('ops@acme.test');
    expect(spaceCreateArgs(space).slice(-2)).toEqual(['--owner', 'ops@acme.test']);
  });
});

describe('manablox create: administrator', () => {
  const given = {
    dir: '/tmp/blog',
    name: 'blog',
    database: 'sqlite' as const,
    preset: 'local' as const,
    publicApi: false,
    site: false,
    adminPort: 3000,
    valkeyPort: 6379,
    storage: 'local' as const,
    mail: 'mailpit' as const,
    space: false,
    git: false,
  };
  const defaults = defaultOptions('/tmp/blog', '0.4.0');

  it('asks for the account, and for its password only when starting', async () => {
    // admin, email, name, install, start, password, repeat
    const starting = scriptedPrompter([
      'y',
      'Ops@Acme.test',
      'Ops',
      'y',
      'y',
      'correct-horse-battery',
      'correct-horse-battery',
    ]);
    expect(await askMissing(given, defaults, starting)).toMatchObject({
      admin: true,
      adminEmail: 'ops@acme.test',
      adminName: 'Ops',
      adminPassword: 'correct-horse-battery',
    });

    // admin, email, name, install
    const later = scriptedPrompter(['', '', '', 'n']);
    const answered = await askMissing(given, defaults, later);
    expect(answered).toMatchObject({ adminEmail: 'admin@example.com', adminPassword: '' });
    expect(later.asked().some((q) => q.includes('Password'))).toBe(false);
  });

  it('skips the password when the environment gave one', async () => {
    const prompter = scriptedPrompter(['y', '', '', 'y', 'y']);
    expect(
      await askMissing({ ...given, adminPassword: 'from-the-environment' }, defaults, prompter),
    ).toMatchObject({ adminPassword: 'from-the-environment', start: true });
  });

  it('treats --admin-email or --admin-name as a yes, but not the admin domain or port', () => {
    expect(optionsFromArgs({ 'admin-email': 'A@B.test' }, {}, [], '/tmp')).toMatchObject({
      admin: true,
      adminEmail: 'a@b.test',
    });
    expect(optionsFromArgs({ 'admin-port': '4000' }, {}, [], '/tmp').admin).toBeUndefined();
    expect(optionsFromArgs({}, { 'no-admin': true }, [], '/tmp').admin).toBe(false);
  });
});
