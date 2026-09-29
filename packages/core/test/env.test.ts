import { describe, expect, it } from 'vitest';
import {
  cacheConfigFromEnv,
  controlApiConfigFromEnv,
  databaseConfigFromEnv,
  type Env,
  envBoolean,
  envList,
  envNumber,
  envScopes,
  MAIL_DRIVER_ENV,
  mailConfigFromEnv,
  mediaConfigFromEnv,
  requireEnv,
  storageConfigFromEnv,
} from '../src/env.js';
import { MAIL_DRIVERS } from '../src/mail.js';

describe('env readers', () => {
  it('parses numbers, booleans and lists with fallbacks', () => {
    const env = { PORT: '3100', FLAG: 'false', LIST: ' a, b ,,c ' };
    expect(envNumber('PORT', 3000, env)).toBe(3100);
    expect(envNumber('MISSING', 3000, env)).toBe(3000);
    expect(envBoolean('FLAG', true, env)).toBe(false);
    expect(envBoolean('MISSING', true, env)).toBe(true);
    expect(envList('LIST', [], env)).toEqual(['a', 'b', 'c']);
    expect(envList('MISSING', ['x'], env)).toEqual(['x']);
  });

  it('names the variable when a number does not parse or a required one is missing', () => {
    expect(() => envNumber('PORT', 1, { PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => requireEnv('DATABASE_URL', {})).toThrow(/DATABASE_URL/);
  });

  it('reads scopes only when set', () => {
    expect(envScopes({})).toBeUndefined();
    expect(envScopes({ SCOPES: 'graphql, media' })).toEqual(['graphql', 'media']);
  });

  it('builds the local storage block by default and S3 on request', () => {
    expect(storageConfigFromEnv({})).toMatchObject({
      driver: 'local',
      local: { path: './data/uploads' },
      maxFileSize: 25 * 1024 * 1024,
    });
    expect(
      storageConfigFromEnv({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_ENDPOINT: 'http://minio:9000',
        FILE_MAX_SIZE_MB: '5',
      }),
    ).toMatchObject({
      driver: 's3',
      s3: { bucket: 'b', endpoint: 'http://minio:9000', forcePathStyle: true },
      maxFileSize: 5 * 1024 * 1024,
    });
  });

  it('reads the local public URL from STORAGE_LOCAL_PUBLIC_URL', () => {
    expect(storageConfigFromEnv({}).local).toEqual({ path: './data/uploads' });
    expect(
      storageConfigFromEnv({
        STORAGE_LOCAL_PATH: '/data/uploads',
        STORAGE_LOCAL_PUBLIC_URL: 'https://files.example.com',
      }).local,
    ).toEqual({ path: '/data/uploads', publicUrl: 'https://files.example.com' });
  });

  it('admits media, text, PDF, office documents and web fonts by default', () => {
    const { allowedMimeTypes = [] } = storageConfigFromEnv({});
    for (const family of ['image/', 'video/', 'audio/', 'text/']) {
      expect(allowedMimeTypes).toContain(family);
    }
    for (const type of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.presentation',
      'font/woff2',
      'font/woff',
    ]) {
      expect(allowedMimeTypes).toContain(type);
    }
    expect(allowedMimeTypes).not.toContain('application/zip');
  });
});

describe('mailConfigFromEnv', () => {
  it('sends no mail without a driver, and reads a bare SMTP_URL as the smtp driver', () => {
    expect(mailConfigFromEnv({})).toEqual({});
    expect(mailConfigFromEnv({ MAIL_DRIVER: 'none', MAIL_FROM: 'CMS <cms@a.test>' })).toEqual({
      from: 'CMS <cms@a.test>',
    });
    expect(mailConfigFromEnv({ SMTP_URL: 'smtp://mail:25' })).toEqual({
      transport: { driver: 'smtp', url: 'smtp://mail:25' },
    });
  });

  it('builds an SMTP transport from its parts when there is no URL', () => {
    expect(
      mailConfigFromEnv({
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'mail.a.test',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'cms',
        SMTP_PASSWORD: 'p@ss/word',
      }).transport,
    ).toEqual({
      driver: 'smtp',
      host: 'mail.a.test',
      port: 465,
      secure: true,
      user: 'cms',
      password: 'p@ss/word',
    });
  });

  it('defaults Mailpit to its local SMTP port', () => {
    expect(mailConfigFromEnv({ MAIL_DRIVER: 'mailpit' }).transport).toEqual({
      driver: 'mailpit',
      host: 'localhost',
      port: 1025,
    });
  });

  it('reads each provider and refuses to start without what it needs', () => {
    expect(
      mailConfigFromEnv({
        MAIL_DRIVER: 'microsoft',
        MICROSOFT_TENANT_ID: 't',
        MICROSOFT_CLIENT_ID: 'c',
        MICROSOFT_CLIENT_SECRET: 's',
        MICROSOFT_SENDER: 'cms@contoso.test',
      }).transport,
    ).toEqual({
      driver: 'microsoft',
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      sender: 'cms@contoso.test',
      saveToSentItems: false,
    });
    expect(
      mailConfigFromEnv({
        MAIL_DRIVER: 'mailgun',
        MAILGUN_API_KEY: 'k',
        MAILGUN_DOMAIN: 'mg.a.test',
        MAILGUN_REGION: 'eu',
      }).transport,
    ).toEqual({ driver: 'mailgun', apiKey: 'k', domain: 'mg.a.test', region: 'eu' });
    expect(() => mailConfigFromEnv({ MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => mailConfigFromEnv({ MAIL_DRIVER: 'gmail', GMAIL_CLIENT_ID: 'c' })).toThrow(
      /GMAIL_CLIENT_SECRET/,
    );
    expect(() => mailConfigFromEnv({ MAIL_DRIVER: 'pigeon' })).toThrow(/MAIL_DRIVER 'pigeon'/);
  });
});

describe('MAIL_DRIVER_ENV', () => {
  /** An env that records which names the reader looks up. */
  function recording(values: Env): { env: Env; read: Set<string> } {
    const read = new Set<string>();
    const env = new Proxy(values, {
      get(target, name) {
        if (typeof name === 'string') read.add(name);
        return target[name as string];
      },
    });
    return { env, read };
  }

  it('lists exactly the variables each driver reads, and which it requires', () => {
    for (const driver of MAIL_DRIVERS) {
      const vars = MAIL_DRIVER_ENV[driver];
      const filled = Object.fromEntries(vars.map((entry) => [entry.name, entry.example || '1']));
      delete filled.SMTP_URL;
      const { env, read } = recording({ MAIL_DRIVER: driver, ...filled });
      expect(() => mailConfigFromEnv(env), driver).not.toThrow();
      read.delete('MAIL_DRIVER');
      read.delete('MAIL_FROM');
      expect([...read].sort(), driver).toEqual(vars.map((entry) => entry.name).sort());

      for (const entry of vars.filter((candidate) => candidate.required)) {
        const { [entry.name]: _, ...without } = filled;
        expect(() => mailConfigFromEnv({ MAIL_DRIVER: driver, ...without }), entry.name).toThrow(
          entry.name,
        );
      }
    }
  });
});

describe('config builders', () => {
  it('reads the control API keys and allowlist', () => {
    expect(controlApiConfigFromEnv({})).toEqual({});
    expect(
      controlApiConfigFromEnv({
        CONTROL_API_KEY: 'a',
        CONTROL_API_KEY_NEXT: 'b',
        CONTROL_API_ALLOWED_IPS: '10.0.0.0/8, ::1',
      }),
    ).toEqual({ apiKey: 'a', nextApiKey: 'b', allowedIps: ['10.0.0.0/8', '::1'] });
    expect(controlApiConfigFromEnv({ CONTROL_PROVISIONED: 'true' })).toEqual({
      provisioned: true,
    });
    expect(controlApiConfigFromEnv({ CONTROL_PROVISIONED: 'false' })).toEqual({});
    expect(
      controlApiConfigFromEnv({
        CONTROL_WEBHOOK_URL: 'https://hooks.test/in',
        CONTROL_WEBHOOK_SECRET: 's',
      }),
    ).toEqual({ webhookUrl: 'https://hooks.test/in', webhookSecret: 's' });
  });

  const full: Env = {
    DATABASE_URL: 'postgres://a/b',
    PUBLIC_DATABASE_URL: 'postgres://ro/b',
    DB_POOL_MAX: '4',
    DATABASE_AUTH_TOKEN: 'tok',
    DATABASE_SSL: 'true',
    MIGRATION_DATABASE_URL: 'postgres://owner/b',
    CACHE_ENABLED: 'false',
    CACHE_TTL: '30',
    PUBLIC_CACHE_TTL: '90',
    CACHE_SYNC_INTERVAL: '0',
    REDIS_URL: 'redis://v:6379',
    AUTH_SECRET: 'auth',
    MEDIA_SIGNING_SECRET: 'sign',
    MEDIA_CACHE_PATH: '/data/mc',
    PUBLIC_MEDIA_CACHE_PATH: '/data/mcp',
  };
  const bare: Env = { DATABASE_URL: 'file:./db', AUTH_SECRET: 'auth' };

  it('reads the database', () => {
    expect(databaseConfigFromEnv({}, full)).toEqual({
      url: 'postgres://a/b',
      max: 4,
      authToken: 'tok',
      migrationUrl: 'postgres://owner/b',
      ssl: true,
    });
    expect(databaseConfigFromEnv({ urlVar: 'PUBLIC_DATABASE_URL' }, full).url).toBe(
      'postgres://ro/b',
    );
    expect(databaseConfigFromEnv({ urlVar: 'PUBLIC_DATABASE_URL' }, bare)).toEqual({
      url: 'file:./db',
      max: 10,
    });
    expect(() => databaseConfigFromEnv({}, {})).toThrow(/DATABASE_URL/);
  });

  it('reads the cache with a per-instance TTL default and variable', () => {
    expect(cacheConfigFromEnv(60, {}, full)).toEqual({
      enabled: false,
      ttl: 30,
      syncInterval: 0,
      redisUrl: 'redis://v:6379',
    });
    expect(cacheConfigFromEnv(300, { ttlVar: 'PUBLIC_CACHE_TTL' }, full).ttl).toBe(90);
    expect(cacheConfigFromEnv(300, {}, bare)).toEqual({ enabled: true, ttl: 300, syncInterval: 5 });
  });

  it('reads media signing and the transform cache', () => {
    expect(mediaConfigFromEnv({}, full)).toEqual({ signingSecret: 'sign', cachePath: '/data/mc' });
    expect(
      mediaConfigFromEnv(
        { cachePathVar: 'PUBLIC_MEDIA_CACHE_PATH', cachePath: './data/media-cache-public' },
        full,
      ).cachePath,
    ).toBe('/data/mcp');
    expect(mediaConfigFromEnv({}, bare)).toEqual({
      signingSecret: 'auth',
      cachePath: './data/media-cache',
    });
    expect(
      mediaConfigFromEnv(
        { cachePathVar: 'PUBLIC_MEDIA_CACHE_PATH', cachePath: './data/media-cache-public' },
        bare,
      ).cachePath,
    ).toBe('./data/media-cache-public');
  });
});
