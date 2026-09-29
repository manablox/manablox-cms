import { describe, expect, it } from 'vitest';
import {
  isAuditAction,
  isAuditActorKind,
  pluginAuditActorKinds,
  pluginAuditEntities,
} from '../src/audit.js';
import { resolveConfig } from '../src/config.js';
import {
  controlEntry,
  describeControls,
  usageMetrics,
  validateControl,
} from '../src/controls/catalogue.js';
import { resolveAll } from '../src/controls/resolve.js';
import { toTransportError } from '../src/errors.js';
import { allPermissions, normaliseGrants, permissionsFor } from '../src/permissions.js';
import { definePlugin, type ManabloxPlugin } from '../src/plugin.js';
import { pluginError } from '../src/plugin-errors.js';
import type { PluginPermission } from '../src/plugin-extensions.js';
import type { StandardSchemaV1 } from '../src/standard-schema.js';

const resolve = (...plugins: ManabloxPlugin[]) =>
  resolveConfig({ database: { url: 'postgres://unused' }, auth: { secret: 's' }, plugins });

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return toTransportError(error);
  }
  throw new Error('not refused');
};

/** A string setting of at most 20 characters. */
const shortText: StandardSchemaV1<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'string' && value.length <= 20
        ? { value }
        : { issues: [{ message: 'Up to 20 characters.' }] },
  },
};

const notes = definePlugin({
  name: 'notes',
  description: 'Notes',
  permissions: [
    { key: 'notes:write', label: 'Write notes', roles: ['author'] },
    { key: 'notes:export', label: 'Export notes', group: 'Exports' },
  ],
  controls: {
    'features.plugins.notes.pinning': { description: 'Pinned notes.' },
    'limits.plugins.notes.count': { description: 'Notes.' },
    'usage.plugins.notes.views': { description: 'Note views.' },
    'rateLimits.plugins.notes.writes': {
      description: 'Note writes.',
      default: { max: 5, windowSeconds: 60 },
    },
    'rateLimits.plugins.notes.exports': { description: 'Exports at once.', concurrency: true },
    'retention.plugins.notes.trashDays': { description: 'Trashed notes.', default: 30 },
    'plugins.notes.title': { description: 'Title.', default: 'Notes', schema: shortText },
  },
  audit: { entities: ['notes.note'], actorKinds: ['notes'] },
  errors: { 'plugins.notes.locked': { kind: 'locked', message: 'Note {id} is locked.' } },
});

describe('plugin catalogue', () => {
  it('adds plugin permissions to the catalogue and the roles they name', () => {
    resolve(notes);
    expect(allPermissions()).toEqual(expect.arrayContaining(['notes:write', 'notes:export']));
    expect(permissionsFor('owner')).toContain('notes:export');
    expect(permissionsFor('admin')).toContain('notes:export');
    expect(permissionsFor('author')).toContain('notes:write');
    expect(permissionsFor('author')).not.toContain('notes:export');
    expect(permissionsFor('viewer')).not.toContain('notes:write');
    expect(normaliseGrants(['notes:write', 'gone:write'], new Set()).unknown).toEqual([
      { index: 1, grant: 'gone:write' },
    ]);
  });

  it('refuses permissions outside the plugin or clashing with core', () => {
    const bad = (permissions: PluginPermission[], name = 'notes') =>
      refusal(() => resolve({ name, permissions })).key;
    expect(bad([{ key: 'other:write', label: 'x' }])).toBe('plugin.key.invalid');
    expect(bad([{ key: 'content:write', label: 'x' }], 'content')).toBe('plugin.key.invalid');
    expect(bad([{ key: 'notes:a:b', label: 'x' }])).toBe('plugin.key.invalid');
    expect(bad([{ key: 'notes:write', label: 'x', roles: ['boss' as 'viewer'] }])).toBe(
      'plugin.key.invalid',
    );
    expect(
      bad([
        { key: 'notes:write', label: 'x' },
        { key: 'notes:write', label: 'y' },
      ]),
    ).toBe('plugin.key.duplicate');
  });

  it('adds plugin controls with their kinds and defaults', () => {
    resolve(notes);
    const described = describeControls().filter((control) => control.key.includes('notes'));
    expect(described.map((control) => [control.key, control.kind])).toEqual([
      ['features.plugins.notes.pinning', 'feature'],
      ['limits.plugins.notes.count', 'limit'],
      ['usage.plugins.notes.views', 'usage'],
      ['rateLimits.plugins.notes.writes', 'rateLimit'],
      ['rateLimits.plugins.notes.exports', 'rateLimit'],
      ['retention.plugins.notes.trashDays', 'retention'],
      ['plugins.notes.title', 'setting'],
    ]);
    expect(usageMetrics()).toContain('plugins.notes.views');
    expect(validateControl('plugins.notes.title', 'x'.repeat(30))).toMatchObject({ ok: false });
    expect(validateControl('plugins.notes.title', 'Mine')).toEqual({ ok: true, value: 'Mine' });
    // A concurrency rule holds a count, no window.
    expect(validateControl('rateLimits.plugins.notes.exports', { max: 2 }).ok).toBe(true);
    expect(validateControl('rateLimits.plugins.notes.writes', { max: 2 }).ok).toBe(false);

    const resolved = resolveAll([
      { scope: { kind: 'instance' }, values: { 'plugins.notes.title': 'Mine' } },
    ]);
    expect(resolved.features['plugins.notes.pinning']).toMatchObject({ enabled: true });
    expect(resolved.limits['plugins.notes.count']).toEqual([]);
    expect(resolved.rateLimits['plugins.notes.writes']).toEqual({ max: 5, windowSeconds: 60 });
    expect(resolved.rateLimits['plugins.notes.exports']).toBeNull();
    expect(resolved.retention['plugins.notes.trashDays']).toBe(30);
    expect(resolved.settings.plugins).toEqual({ 'notes.title': 'Mine' });
  });

  it('keeps a declared feature apart from another plugin flag', () => {
    resolve(notes);
    expect(controlEntry('features.plugins.notes.pinning')?.description).toBe('Pinned notes.');
    // The flag of a plugin named `notes/other`, not declared by `notes`.
    expect(controlEntry('features.plugins.notes.other')?.description).toMatch(/A plugin, by id/);
    const clash = definePlugin({
      name: 'a',
      controls: { 'features.plugins.a.b': { description: 'B.' } },
    });
    expect(refusal(() => resolve(clash, { name: 'a/b' })).key).toBe('plugin.key.duplicate');
  });

  it('refuses controls outside the plugin namespace', () => {
    const bad = (key: string) =>
      refusal(() => resolve({ name: 'notes', controls: { [key]: { description: 'x' } } as never }))
        .key;
    expect(bad('features.plugins.other.x')).toBe('plugin.key.invalid');
    expect(bad('features.sso')).toBe('plugin.key.invalid');
    expect(bad('limits.plugins.notes')).toBe('plugin.key.invalid');
  });

  it('registers audit entities and error keys', () => {
    resolve(notes);
    expect(pluginAuditEntities()).toContain('notes.note');
    expect(isAuditAction('notes.note.pin')).toBe(true);
    expect(isAuditAction('notes.other.pin')).toBe(false);
    expect(pluginAuditActorKinds()).toEqual(['notes']);
    expect(isAuditActorKind('notes')).toBe(true);
    expect(isAuditActorKind('system')).toBe(true);
    expect(isAuditActorKind('robot')).toBe(false);
    expect(toTransportError(pluginError('plugins.notes.locked', { id: 7 }))).toMatchObject({
      key: 'plugins.notes.locked',
      kind: 'locked',
      status: 423,
      message: 'Note 7 is locked.',
    });
    expect(
      refusal(() => resolve({ name: 'notes', errors: { 'plugins.other.x': { message: 'x' } } }))
        .key,
    ).toBe('plugin.key.invalid');
    expect(
      refusal(() =>
        resolve({
          name: 'notes',
          audit: { entities: ['other.x'] },
        }),
      ).key,
    ).toBe('plugin.key.invalid');
    expect(
      refusal(() => resolve({ name: 'notes', audit: { entities: [], actorKinds: ['other'] } })).key,
    ).toBe('plugin.key.invalid');
  });

  it('refuses two plugins with one id and bad job names', () => {
    expect(refusal(() => resolve(notes, { ...notes, name: 'Notes' })).key).toBe(
      'plugin.id.duplicate',
    );
    const job = async () => {};
    expect(refusal(() => resolve({ name: 'notes', jobs: { 'a:b': job } })).key).toBe(
      'plugin.key.invalid',
    );
    expect(
      refusal(() =>
        resolve({ name: 'notes', maintenance: [{ name: 'tick', every: 10, run: job }] }),
      ).key,
    ).toBe('plugin.key.invalid');
  });
});
