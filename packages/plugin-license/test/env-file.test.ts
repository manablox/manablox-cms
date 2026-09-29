import { generateLicenseKey, keyId } from '@manablox/license';
import { describe, expect, it } from 'vitest';
import { envKeys, withKey, withoutKey } from '../src/cli/env-file.js';

const A = generateLicenseKey();
const B = generateLicenseKey();

describe('.env edits of MANABLOX_LICENSE_KEYS', () => {
  it('fills the empty entry the template writes, and keeps what is around it', () => {
    const text = '# keys\nMANABLOX_LICENSE_KEYS=\nOTHER=1\n';
    const edited = withKey(text, A);
    expect(edited).toEqual({
      text: `# keys\nMANABLOX_LICENSE_KEYS=${A}\nOTHER=1\n`,
      changed: true,
    });
    expect(envKeys(edited.text)).toEqual([A]);
  });

  it('appends to the list, and adds a key only once whatever its spelling in the file', () => {
    const once = withKey(`MANABLOX_LICENSE_KEYS=${A}\n`, B).text;
    expect(once).toBe(`MANABLOX_LICENSE_KEYS=${A},${B}\n`);
    // The file may spell it in lower case; the key given is normalised.
    const lower = once.replace(B, B.toLowerCase());
    expect(withKey(lower, B)).toEqual({ text: lower, changed: false });
  });

  it('creates the entry when the file has none, with a line break before it', () => {
    expect(withKey('AUTH_SECRET=x', A).text).toBe(`AUTH_SECRET=x\nMANABLOX_LICENSE_KEYS=${A}\n`);
    expect(withKey('', A).text).toBe(`MANABLOX_LICENSE_KEYS=${A}\n`);
  });

  it('keeps quotes, export and a trailing comment, and edits the last entry', () => {
    expect(withKey(`export MANABLOX_LICENSE_KEYS="${A}"\n`, B).text).toBe(
      `export MANABLOX_LICENSE_KEYS="${A},${B}"\n`,
    );
    expect(withKey(`MANABLOX_LICENSE_KEYS=${A} # prod\n`, B).text).toBe(
      `MANABLOX_LICENSE_KEYS=${A},${B} # prod\n`,
    );
    const twice = `MANABLOX_LICENSE_KEYS=${A}\nMANABLOX_LICENSE_KEYS=\n`;
    expect(withKey(twice, B).text).toBe(`MANABLOX_LICENSE_KEYS=${A}\nMANABLOX_LICENSE_KEYS=${B}\n`);
  });

  it('removes keys by their id', () => {
    const text = `MANABLOX_LICENSE_KEYS=${A},${B}\n`;
    expect(withoutKey(text, keyId(A))).toEqual({
      text: `MANABLOX_LICENSE_KEYS=${B}\n`,
      removed: [A],
    });
    expect(withoutKey(text, 'ZZZZZ')).toEqual({ text, removed: [] });
    expect(withoutKey('OTHER=1\n', keyId(A)).removed).toEqual([]);
  });
});
