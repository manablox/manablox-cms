import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { policy } from '../src/middleware/csp.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const base = {
  enabled: true,
  reportOnly: true,
  frameSrc: ['*'],
  imgSrc: ['*'],
  connectSrc: [],
};

describe('admin content security policy', () => {
  it('closes what the admin never needs', () => {
    const value = policy(base);
    expect(value).toContain("script-src 'self'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("base-uri 'self'");
    expect(value).toContain("form-action 'self'");
    // Nothing should be able to frame the admin and drive it from outside.
    expect(value).toContain("frame-ancestors 'none'");
  });

  it('leaves images and frames open by default, since both depend on runtime data', () => {
    const value = policy(base);
    expect(value).toContain("img-src 'self' data: blob: *");
    expect(value).toContain('frame-src *');
  });

  it('narrows to the origins an operator names', () => {
    const value = policy({
      ...base,
      frameSrc: ['https://site.example'],
      imgSrc: ['https://cdn.example'],
      connectSrc: ['https://api.example'],
    });
    expect(value).toContain('frame-src https://site.example');
    expect(value).toContain("img-src 'self' data: blob: https://cdn.example");
    expect(value).toContain("connect-src 'self' https://api.example");
  });

  it('refuses every frame when the operator names none', () => {
    expect(policy({ ...base, frameSrc: [] })).toContain("frame-src 'none'");
  });

  it('carries a report endpoint when one is configured', () => {
    expect(policy({ ...base, reportUri: '/csp-report' })).toContain('report-uri /csp-report');
    expect(policy(base)).not.toContain('report-uri');
  });
});

describe('the header on the admin document', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  const built = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'manablox-csp-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="app"></div>');
    return dir;
  };

  const load = async (csp?: Record<string, unknown>) => {
    const { runtime } = stubRuntime({
      server: { admin: { dir: built() }, ...(csp ? { csp } : {}) },
    } as never);
    await initialised(runtime);
    const app = await createApp(runtime);
    return app.request(new Request('http://admin.test/', { headers: { accept: 'text/html' } }));
  };

  it('is report-only until an operator enforces it', async () => {
    const res = await load();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy-report-only')).toContain("script-src 'self'");
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('enforces once told to', async () => {
    const res = await load({ reportOnly: false });
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
  });

  it('sends nothing when it is turned off', async () => {
    const res = await load({ enabled: false });
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('does not stamp an API response, where a policy means nothing', async () => {
    const { runtime } = stubRuntime({ server: { admin: { dir: built() } } } as never);
    await initialised(runtime);
    const app = await createApp(runtime);
    const res = await app.request(new Request('http://admin.test/healthz'));
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
  });
});
