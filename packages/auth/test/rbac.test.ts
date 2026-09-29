import { describe, expect, it } from 'vitest';
import {
  actorRoles,
  allowedTypeIds,
  assertCan,
  can,
  type Principal,
  permissionsFor,
} from '../src/rbac.js';

const SPACE = 'space-1';

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  email: 'u@example.com',
  role: 'editor',
  spaces: { [SPACE]: 'editor' },
  ...over,
});

describe('rbac', () => {
  it('denies everything to an anonymous caller', () => {
    expect(can(null, SPACE, 'content:read')).toBe(false);
    expect(() => assertCan(null, SPACE, 'content:read')).toThrow(/unauthorized/);
  });

  it('lets an author write but not publish - the reason the role exists', () => {
    const author = principal({ spaces: { [SPACE]: 'author' } });
    expect(can(author, SPACE, 'content:write')).toBe(true);
    expect(can(author, SPACE, 'content:publish')).toBe(false);
    expect(() => assertCan(author, SPACE, 'content:publish')).toThrow(/forbidden/);
  });

  it('confines a viewer to reads', () => {
    const viewer = principal({ spaces: { [SPACE]: 'viewer' } });
    expect(can(viewer, SPACE, 'content:read')).toBe(true);
    expect(can(viewer, SPACE, 'content:write')).toBe(false);
    expect(can(viewer, SPACE, 'asset:write')).toBe(false);
  });

  it('grants nothing in a space the user is not a member of', () => {
    expect(can(principal(), 'other-space', 'content:read')).toBe(false);
  });

  it('short-circuits every check for a superadmin', () => {
    const root = principal({ role: 'superadmin', spaces: {} });
    expect(can(root, 'any-space', 'space:delete')).toBe(true);
  });

  it('reserves space deletion for the owner', () => {
    expect(can(principal({ spaces: { [SPACE]: 'admin' } }), SPACE, 'space:delete')).toBe(false);
    expect(can(principal({ spaces: { [SPACE]: 'owner' } }), SPACE, 'space:delete')).toBe(true);
  });

  it('exposes the roles a field-level permission check needs', () => {
    expect(actorRoles(principal({ role: 'editor' }), SPACE)).toEqual(['editor', 'editor']);
    expect(actorRoles(null, SPACE)).toEqual([]);
  });

  it('never grants a write permission through a read-only role', () => {
    for (const permission of permissionsFor('viewer')) {
      expect(permission.endsWith(':read')).toBe(true);
    }
  });

  describe('a custom role', () => {
    const TYPE = 'type-1';
    const blogger = principal({
      spaces: { [SPACE]: 'blogger' },
      permissions: { [SPACE]: ['space:read', 'content:read', `content:write:${TYPE}`] },
    });

    it('answers from its own grants rather than the built-in table', () => {
      expect(can(blogger, SPACE, 'content:read')).toBe(true);
      expect(can(blogger, SPACE, 'asset:read')).toBe(false);
    });

    it('holds a content action for every type, or for the types named', () => {
      expect(can(blogger, SPACE, 'content:read', 'type-2')).toBe(true);
      expect(can(blogger, SPACE, 'content:write', TYPE)).toBe(true);
      expect(can(blogger, SPACE, 'content:write', 'type-2')).toBe(false);
      // Without a type: can the role write anything?
      expect(can(blogger, SPACE, 'content:write')).toBe(true);
      expect(can(blogger, SPACE, 'content:publish')).toBe(false);
    });

    it('tells a listing which types to narrow to', () => {
      expect(allowedTypeIds(blogger, SPACE, 'content:read')).toBeNull();
      expect(allowedTypeIds(blogger, SPACE, 'content:write')).toEqual([TYPE]);
      expect(allowedTypeIds(blogger, SPACE, 'content:publish')).toEqual([]);
      expect(allowedTypeIds(principal({ role: 'superadmin' }), SPACE, 'content:write')).toBeNull();
    });

    it('is nothing in a space where the name is unknown and no grants came along', () => {
      const ghost = principal({ spaces: { [SPACE]: 'ghost' } });
      expect(can(ghost, SPACE, 'content:read')).toBe(false);
    });
  });

  describe('an API key confined to grants', () => {
    const TYPE = 'type-1';
    const key = principal({
      spaces: { [SPACE]: 'editor' },
      viaApiKey: true,
      allowedGrants: ['content:read', `content:write:${TYPE}`, 'space:delete'],
    });

    it('never widens the owner: a grant the role lacks stays refused', () => {
      expect(can(key, SPACE, 'space:delete')).toBe(false);
    });

    it('narrows the owner to the grants named', () => {
      expect(can(key, SPACE, 'content:read')).toBe(true);
      expect(can(key, SPACE, 'content:write', TYPE)).toBe(true);
      expect(can(key, SPACE, 'content:write', 'type-2')).toBe(false);
      expect(can(key, SPACE, 'asset:read')).toBe(false);
      expect(allowedTypeIds(key, SPACE, 'content:write')).toEqual([TYPE]);
    });

    it('binds a superadmin too', () => {
      const root = principal({ role: 'superadmin', spaces: {}, allowedGrants: ['content:read'] });
      expect(can(root, SPACE, 'content:read')).toBe(true);
      expect(can(root, SPACE, 'space:delete')).toBe(false);
      expect(allowedTypeIds(root, SPACE, 'content:read')).toBeNull();
      expect(allowedTypeIds(root, SPACE, 'content:write')).toEqual([]);
    });
  });
});
