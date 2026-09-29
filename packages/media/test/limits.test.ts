import { describe, expect, it } from 'vitest';
import { mimeTypeAllowed, resolveUploadRules, withinInstance } from '../src/limits.js';
import { detectMimeType } from '../src/transform.js';

const instance = { allowedMimeTypes: ['image/', 'application/pdf'], maxFileSize: 10_000 };
const unset = { maxFileSize: null, allowedMimeTypes: null };

describe('resolveUploadRules', () => {
  it('falls back to the instance when neither controls nor the space set anything', () => {
    expect(resolveUploadRules(instance, null, null).effective).toEqual({
      allowedMimeTypes: ['image/', 'application/pdf'],
      maxFileSize: 10_000,
    });
  });

  it('lets a space narrow, and drops what would widen', () => {
    const { effective } = resolveUploadRules(instance, null, {
      allowedMimeTypes: ['image/png', 'video/'],
      maxFileSize: 50_000,
    });
    expect(effective).toEqual({ allowedMimeTypes: ['image/png'], maxFileSize: 10_000 });
  });

  it('reads an instance with no allowlist as everything', () => {
    expect(
      resolveUploadRules({ maxFileSize: 5 }, null, { allowedMimeTypes: ['video/'] }).effective,
    ).toEqual({ allowedMimeTypes: ['video/'], maxFileSize: 5 });
    expect(resolveUploadRules({ maxFileSize: 5 }, null, null).effective.allowedMimeTypes).toBe(
      null,
    );
  });

  it('takes the strictest of env, controls and space, per bound', () => {
    const controls = { maxFileSize: 4_000, allowedMimeTypes: ['image/', 'video/'] };
    const rules = resolveUploadRules(instance, controls, { maxFileSize: 6_000 });
    expect(rules.effective).toEqual({ allowedMimeTypes: ['image/'], maxFileSize: 4_000 });
    expect(rules.ceiling).toEqual(rules.effective);
    expect(rules.instance).toEqual(instance);
    expect(rules.controls).toEqual(controls);

    const narrower = resolveUploadRules(instance, controls, {
      maxFileSize: 1_000,
      allowedMimeTypes: ['image/png'],
    });
    expect(narrower.effective).toEqual({ allowedMimeTypes: ['image/png'], maxFileSize: 1_000 });
    expect(narrower.ceiling).toEqual({ allowedMimeTypes: ['image/'], maxFileSize: 4_000 });
  });

  it('narrows a family to the exact types a control lists', () => {
    const { effective } = resolveUploadRules(
      instance,
      { ...unset, allowedMimeTypes: ['image/png', 'text/plain'] },
      null,
    );
    expect(effective.allowedMimeTypes).toEqual(['image/png']);
  });

  it('admits nothing when the lists do not meet', () => {
    const { effective } = resolveUploadRules(
      instance,
      { ...unset, allowedMimeTypes: ['video/'] },
      { allowedMimeTypes: ['image/png'] },
    );
    expect(effective.allowedMimeTypes).toEqual([]);
  });
});

describe('withinInstance / mimeTypeAllowed', () => {
  it('a family is inside only as a whole family; an exact type through its family', () => {
    expect(withinInstance('image/', ['image/'])).toBe(true);
    expect(withinInstance('image/', ['image/png'])).toBe(false);
    expect(withinInstance('image/png', ['image/'])).toBe(true);
    expect(withinInstance('image/png', ['image/jpeg'])).toBe(false);
  });

  it('matches uploads by exact type or family', () => {
    expect(mimeTypeAllowed('image/webp', ['image/'])).toBe(true);
    expect(mimeTypeAllowed('image/webp', ['image/png'])).toBe(false);
    expect(mimeTypeAllowed('text/plain', [])).toBe(true);
  });
});

describe('detectMimeType', () => {
  it('knows web fonts by their signature, whatever the browser declared', async () => {
    const woff2 = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]);
    const woff = Buffer.from([0x77, 0x4f, 0x46, 0x46, 0, 1, 0, 0]);
    expect(await detectMimeType(woff2, 'application/octet-stream')).toBe('font/woff2');
    expect(await detectMimeType(woff, '')).toBe('font/woff');
    expect(await detectMimeType(Buffer.from('plain'), 'font/woff2')).toBe('font/woff2');
  });
});
