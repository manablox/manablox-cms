import type { PluginPermission, PluginPermissionKey } from './plugin-extensions.js';

/** The roles every space has; defined in code so `owner` cannot be edited away. */
export type BuiltInRole = 'owner' | 'admin' | 'editor' | 'author' | 'viewer';
export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  'owner',
  'admin',
  'editor',
  'author',
  'viewer',
];

/** Any role name, built-in or custom. */
export type SpaceRole = string;

export type CorePermission =
  | 'space:read'
  | 'space:write'
  | 'space:delete'
  | 'space:export'
  | 'contentType:read'
  | 'contentType:write'
  | 'contentType:delete'
  | 'content:read'
  | 'content:write'
  | 'content:delete'
  | 'content:publish'
  | 'asset:read'
  | 'asset:write'
  | 'asset:delete'
  | 'user:read'
  | 'user:write'
  | 'menu:read'
  | 'menu:write'
  | 'redirect:read'
  | 'redirect:write'
  | 'credential:read'
  | 'credential:write'
  | 'role:read'
  | 'role:write'
  | 'audit:read'
  | 'environment:manage';

/** A core permission or a plugin's `<pluginId>:<action>`. */
export type Permission = CorePermission | PluginPermissionKey;

/** The actions on documents, which a role may hold for every type or for some. */
export type ContentAction = 'read' | 'write' | 'delete' | 'publish';

/** Held by every role; the admin cannot render without them. */
export const ALWAYS_GRANTED: readonly Permission[] = ['space:read', 'contentType:read'];
export const CONTENT_ACTIONS: readonly ContentAction[] = ['read', 'write', 'delete', 'publish'];
export type ContentPermission = `content:${ContentAction}`;

/** A `Permission`, or a content permission narrowed to one type: `content:write:<typeId>`. */
export type Grant = Permission | `${ContentPermission}:${string}`;

/** Permissions grouped for the role editor. */
export interface PermissionGroup {
  id: string;
  label: string;
  description: string;
  permissions: Array<{ id: Permission; label: string; description: string }>;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: 'space',
    label: 'Space',
    description: 'The space itself: its settings, locales and upload limits.',
    permissions: [
      { id: 'space:read', label: 'See the space', description: 'Open it in the admin at all.' },
      {
        id: 'space:write',
        label: 'Change settings',
        description: 'Name, URL, locales, uploads, the home page.',
      },
      { id: 'space:delete', label: 'Delete the space', description: 'With everything in it.' },
      {
        id: 'space:export',
        label: 'Export the space',
        description:
          'Download it as a transfer file or as config source: every field of every document, whatever the read rules.',
      },
    ],
  },
  {
    id: 'contentType',
    label: 'Content types',
    description: 'The shapes documents and blocks take.',
    permissions: [
      { id: 'contentType:read', label: 'See content types', description: '' },
      {
        id: 'contentType:write',
        label: 'Create and edit content types',
        description:
          'A role with this and type-specific content permissions is granted every content permission on each type it creates.',
      },
      { id: 'contentType:delete', label: 'Delete content types', description: '' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    description: 'Documents. Each action can be granted for every content type, or type by type.',
    permissions: [
      { id: 'content:read', label: 'Read', description: 'Open documents, including drafts.' },
      { id: 'content:write', label: 'Write', description: 'Create, edit, move and translate.' },
      { id: 'content:delete', label: 'Delete', description: '' },
      { id: 'content:publish', label: 'Publish', description: 'Publish and unpublish.' },
    ],
  },
  {
    id: 'asset',
    label: 'Assets',
    description: 'The file library.',
    permissions: [
      { id: 'asset:read', label: 'See assets', description: '' },
      { id: 'asset:write', label: 'Upload and edit assets', description: '' },
      { id: 'asset:delete', label: 'Delete assets', description: '' },
    ],
  },
  {
    id: 'menu',
    label: 'Menus',
    description: 'The navigations a frontend renders.',
    permissions: [
      { id: 'menu:read', label: 'See menus', description: '' },
      { id: 'menu:write', label: 'Create and edit menus', description: '' },
    ],
  },
  {
    id: 'redirect',
    label: 'Redirects',
    description: 'Old addresses and where they lead.',
    permissions: [
      { id: 'redirect:read', label: 'See redirects', description: '' },
      {
        id: 'redirect:write',
        label: 'Add, edit and remove redirects',
        description: 'Automatic redirects from address changes are recorded either way.',
      },
    ],
  },
  {
    id: 'credential',
    label: 'Credentials',
    description: 'The secrets webhooks and plugins sign in with when they call other systems.',
    permissions: [
      {
        id: 'credential:read',
        label: 'See credentials',
        description: 'Their names and kinds, never the secrets.',
      },
      {
        id: 'credential:write',
        label: 'Add, edit and remove credentials',
        description: 'Secrets can be replaced but are never shown again.',
      },
    ],
  },
  {
    id: 'user',
    label: 'Members',
    description: 'Who is in the space.',
    permissions: [
      { id: 'user:read', label: 'See members', description: '' },
      {
        id: 'user:write',
        label: 'Add, remove and change members',
        description: 'Including which role each one holds.',
      },
    ],
  },
  {
    id: 'role',
    label: 'Roles',
    description: 'What each role in the space may do.',
    permissions: [
      { id: 'role:read', label: 'See roles', description: '' },
      { id: 'role:write', label: 'Create and edit roles', description: '' },
    ],
  },
  {
    id: 'audit',
    label: 'Activity',
    description: 'The log of everything done in the space: who, when, what changed.',
    permissions: [
      {
        id: 'audit:read',
        label: 'See the activity log',
        description: 'Every action in the space, with the values before and after.',
      },
    ],
  },
  {
    id: 'environment',
    label: 'Environments',
    description: 'Staging copies of the space and promoting them to production.',
    permissions: [
      {
        id: 'environment:manage',
        label: 'Manage environments',
        description:
          'Create and delete staging environments, and promote one to production, which changes the live space.',
      },
    ],
  },
];

/** The core permissions; `allPermissions()` adds the plugins'. */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.id),
);

/** Built-in role -> core permissions. */
const ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((permission) => permission !== 'space:delete'),
  editor: [
    'space:read',
    'contentType:read',
    'content:read',
    'content:write',
    'content:delete',
    'content:publish',
    'asset:read',
    'asset:write',
    'asset:delete',
    'user:read',
    'menu:read',
    'menu:write',
    'redirect:read',
    'redirect:write',
    'credential:read',
    'role:read',
  ],
  // Writes and deletes, never publishes.
  author: [
    'space:read',
    'contentType:read',
    'content:read',
    'content:write',
    'content:delete',
    'asset:read',
    'asset:write',
    'user:read',
    'menu:read',
  ],
  viewer: [
    'space:read',
    'contentType:read',
    'content:read',
    'asset:read',
    'user:read',
    'menu:read',
    'redirect:read',
  ],
};

/** Registered plugin permissions by plugin id, with the merged views built from them. */
const pluginPermissions = new Map<string, PluginPermissionSet>();

interface PluginPermissionSet {
  /** The default group's label and description. */
  label: string;
  description: string;
  permissions: readonly PluginPermission[];
}
let merged: {
  groups: readonly PermissionGroup[];
  all: readonly Permission[];
  roles: Record<BuiltInRole, readonly Permission[]>;
} | null = null;

/** Replaces one plugin's permissions; checked by `resolveConfig`. */
export function setPluginPermissions(id: string, set: PluginPermissionSet): void {
  if (set.permissions.length === 0) pluginPermissions.delete(id);
  else pluginPermissions.set(id, set);
  merged = null;
}

function mergedPermissions() {
  if (merged) return merged;
  const groups: PermissionGroup[] = [...PERMISSION_GROUPS];
  const roles = Object.fromEntries(
    BUILT_IN_ROLES.map((role) => [role, [...ROLE_PERMISSIONS[role]]]),
  ) as Record<BuiltInRole, Permission[]>;
  for (const [id, set] of pluginPermissions) {
    const byGroup = new Map<string, PermissionGroup>();
    for (const permission of set.permissions) {
      const label = permission.group ?? set.label;
      let group = byGroup.get(label);
      if (!group) {
        group = {
          id: byGroup.size ? `plugins.${id}.${byGroup.size}` : `plugins.${id}`,
          label,
          description: label === set.label ? set.description : '',
          permissions: [],
        };
        byGroup.set(label, group);
        groups.push(group);
      }
      group.permissions.push({
        id: permission.key,
        label: permission.label,
        description: permission.description ?? '',
      });
      for (const role of new Set<BuiltInRole>(['owner', 'admin', ...(permission.roles ?? [])])) {
        roles[role].push(permission.key);
      }
    }
  }
  merged = { groups, all: groups.flatMap((g) => g.permissions.map((p) => p.id)), roles };
  return merged;
}

/** Core and plugin permissions grouped for the role editor. */
export function permissionGroups(): readonly PermissionGroup[] {
  return mergedPermissions().groups;
}

/** Every core and plugin permission. */
export function allPermissions(): readonly Permission[] {
  return mergedPermissions().all;
}

export function isBuiltInRole(role: string): role is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(role);
}

/** The permissions of a built-in role; an unknown name has none. */
export function permissionsFor(role: string): readonly Permission[] {
  return isBuiltInRole(role) ? mergedPermissions().roles[role] : [];
}

const isContentPermission = (permission: string): permission is ContentPermission =>
  permission.startsWith('content:');

/** Whether grants cover a permission, broadly or for `typeId`. Without a type, any type counts. */
export function grantsCover(
  grants: readonly string[],
  permission: Permission,
  typeId?: string | null,
): boolean {
  if (grants.includes(permission)) return true;
  if (!isContentPermission(permission)) return false;
  if (typeId) return grants.includes(`${permission}:${typeId}`);
  return grants.some((grant) => grant.startsWith(`${permission}:`));
}

/** The content types a set of grants narrows an action to; `null` when it covers all. */
export function typesCoveredBy(
  grants: readonly string[],
  permission: ContentPermission,
): string[] | null {
  if (grants.includes(permission)) return null;
  const prefix = `${permission}:`;
  return grants
    .filter((grant) => grant.startsWith(prefix))
    .map((grant) => grant.slice(prefix.length));
}

/** A grant taken apart: the permission and, for a content action on one type, the type. */
export function parseGrant(grant: string): { permission: string; typeId: string | null } | null {
  const parts = grant.split(':');
  if (parts.length === 2) return { permission: grant, typeId: null };
  if (parts.length === 3 && parts[0] === 'content') {
    return { permission: `${parts[0]}:${parts[1]}`, typeId: parts[2] as string };
  }
  return null;
}

/** Splits grants into valid ones (plus `always`) and unknown ones with their index. */
export function normaliseGrants(
  grants: readonly string[],
  knownTypeIds: ReadonlySet<string>,
  always: readonly string[] = [],
): { permissions: string[]; unknown: Array<{ index: number; grant: string }> } {
  const kept = new Set<string>(always);
  const unknown: Array<{ index: number; grant: string }> = [];
  for (const [index, grant] of grants.entries()) {
    const parsed = parseGrant(grant);
    const catalogued =
      parsed && (allPermissions() as readonly string[]).includes(parsed.permission);
    const typed = parsed?.typeId
      ? isContentPermission(parsed.permission) && knownTypeIds.has(parsed.typeId)
      : true;
    if (catalogued && typed) kept.add(grant);
    else unknown.push({ index, grant });
  }
  return { permissions: [...kept], unknown };
}

/** `held` narrowed to `allowed`, as an API key restricts its owner's role. */
export function intersectGrants(held: readonly string[], allowed: readonly string[]): string[] {
  const out = new Set<string>();
  for (const grant of allowed) {
    const parsed = parseGrant(grant);
    if (!parsed) continue;
    // Broad needs broad; `grantsCover` without a type would accept any type.
    const covered = parsed.typeId
      ? grantsCover(held, parsed.permission as Permission, parsed.typeId)
      : held.includes(grant);
    if (covered) {
      out.add(grant);
    } else if (!parsed.typeId && isContentPermission(parsed.permission)) {
      // Allowed broadly, held for some types: keep those.
      for (const typeId of typesCoveredBy(held, parsed.permission) ?? []) {
        out.add(`${parsed.permission}:${typeId}`);
      }
    }
  }
  return [...out];
}
