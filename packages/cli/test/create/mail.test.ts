import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { create } from '../../src/create/index.js';
import { docker, file, options, render } from '../helpers/create.js';
import { tempDirs } from '../helpers/temp-dir.js';

const tempDir = tempDirs('manablox-create-');

describe('manablox create: mail', () => {
  it('runs Mailpit as a service of the Docker stack and points the api at it', async () => {
    const files = await render(docker({ mail: 'mailpit' }));
    const compose = file(files, 'compose.yml');
    expect(compose).toContain('  mailpit:\n    image: axllent/mailpit:latest');
    expect(compose).toContain(`- '127.0.0.1:\${MAILPIT_UI_PORT:-8025}:8025'`);
    expect(compose).toContain('MAILPIT_HOST: mailpit');
    // The host is the service name, so .env carries only the inbox port.
    const env = file(files, '.env');
    expect(env).toContain('MAIL_DRIVER=mailpit');
    expect(env).not.toContain('MAILPIT_HOST');
    expect(env).toContain('MAILPIT_UI_PORT=8025');
  });

  it('publishes Mailpit next to Postgres and Valkey for local development', async () => {
    const files = await render(options({ preset: 'local', mail: 'mailpit' }));
    expect(file(files, 'compose.yml')).toContain(`- '\${MAILPIT_PORT:-1025}:1025'`);
    expect(file(files, '.env')).toContain('MAILPIT_HOST=localhost\nMAILPIT_PORT=1025\n');
    expect(file(files, 'README.md')).toContain('<http://localhost:8025>');
  });

  it("writes a provider's variables blank and leaves compose.yml alone", async () => {
    const files = await render(docker({ mail: 'microsoft' }));
    const env = file(files, '.env');
    expect(env).toContain('MAIL_DRIVER=microsoft');
    // A mailbox sends as itself unless told otherwise.
    expect(env).toContain('MAIL_FROM=\n');
    for (const name of ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SENDER']) {
      expect(env).toContain(`MICROSOFT_${name}=\n`);
    }
    expect(env).not.toContain('SMTP_');

    // The api reads all of .env, so any driver works without an edit here.
    const compose = file(files, 'compose.yml');
    expect(compose).not.toContain('MICROSOFT_');
    expect(compose).not.toContain('mailpit');
    const readme = file(files, 'README.md');
    expect(readme).toContain('Mail goes out through `microsoft`');
    expect(readme).not.toContain('compose.yml` (it passes');
  });

  it('gives a sender on the admin domain to a provider that needs one', async () => {
    const files = await render(docker({ adminDomain: 'cms.acme.test', mail: 'resend' }));
    const env = file(files, '.env');
    expect(env).toContain('MAIL_FROM=Manablox <no-reply@cms.acme.test>');
    expect(env).toContain('RESEND_API_KEY=\n');
    expect(file(files, '.env.example')).toContain('RESEND_API_KEY=\n');
  });

  it('defaults to Mailpit for local development and to no mail for a Docker stack', async () => {
    const out = new PassThrough();
    out.resume();
    const flags = { 'no-install': true, 'no-git': true, yes: true };
    const context = { prompter: null, out, cliVersion: '0.4.0' };

    const local = tempDir();
    await create({}, flags, ['.'], { ...context, cwd: local });
    expect(readFileSync(join(local, '.env'), 'utf8')).toContain('MAIL_DRIVER=mailpit');
    expect(readdirSync(local)).not.toContain('Dockerfile');

    const stack = tempDir();
    await create({ preset: 'docker' }, flags, ['.'], { ...context, cwd: stack });
    expect(readFileSync(join(stack, '.env'), 'utf8')).toContain('MAIL_DRIVER=none');
  });
});
