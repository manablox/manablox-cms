import {
  ALWAYS_GRANTED,
  auditor,
  BUILT_IN_ROLES,
  CONTENT_ACTIONS,
  type ContentAction,
  diffRecords,
  isBuiltInRole,
  isMachineName,
  ManabloxError,
  normaliseGrants,
  permissionGroups,
  permissionsFor,
  snapshotChanges,
  ValidationCollector,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Repositories, type RoleRow, uniqueViolation } from '@manablox/db';
import { requireInSpace } from './lib.js';

/** A role; built-in ones have no row and are read-only. */
export interface RoleView {
  id: string | null;
  spaceId: string;
  name: string;
  machineName: string;
  description: string | null;
  permissions: string[];
  builtIn: boolean;
}

export interface RoleInput {
  name: string;
  machineName: string;
  description?: string | null | undefined;
  permissions: string[];
}

const BUILT_IN_LABELS: Record<(typeof BUILT_IN_ROLES)[number], [string, string]> = {
  owner: ['Owner', 'Everything, including deleting the space.'],
  admin: ['Admin', 'Everything except deleting the space.'],
  editor: ['Editor', 'Reads and writes content, assets and menus; publishes.'],
  author: ['Author', 'Writes and deletes content, but never publishes.'],
  viewer: ['Viewer', 'Read only.'],
};

/** A space's built-in and custom roles; memberships name them by machine name. */
export class RoleService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = auditor(
      repos,
      'role',
      (role: { id: string | null; spaceId: string; name: string }) => role.name,
    );
  }

  /** This service on other repositories, e.g. a transaction's. */
  using(repos: Repositories): RoleService {
    return new RoleService(this.manablox, repos);
  }

  /** The permission catalogue for the role editor. */
  catalog() {
    return { groups: permissionGroups(), contentActions: CONTENT_ACTIONS };
  }

  async list(spaceId: string): Promise<RoleView[]> {
    const custom = await this.repos.roles.listBySpace(spaceId);
    return [
      ...BUILT_IN_ROLES.map((role) => builtIn(spaceId, role)),
      ...custom.map((row) => fromRow(row)),
    ];
  }

  async get(spaceId: string, id: string): Promise<RoleView> {
    return fromRow(
      requireInSpace(await this.repos.roles.findById(id), spaceId, 'role.notFound', { id }),
    );
  }

  /** Whether a membership may name this role in this space. */
  async exists(spaceId: string, machineName: string): Promise<boolean> {
    if (isBuiltInRole(machineName)) return true;
    return (await this.repos.roles.findByMachineName(spaceId, machineName)) !== null;
  }

  async create(spaceId: string, input: RoleInput): Promise<RoleView> {
    await this.manablox.controls.assertFeature(spaceId, 'customRoles');
    const data = this.validate(spaceId, input);
    await this.manablox.controls.assertLimit(spaceId, 'customRolesPerSpace');
    return this.repos.transaction(async (tx) => {
      const row = await tx.roles
        .create(spaceId, data)
        .catch(machineNameConflict({ machineName: input.machineName }));
      await this.audit.in(tx).record('role.create', row, snapshotChanges(row, 'created'));
      return fromRow(row);
    });
  }

  async update(spaceId: string, id: string, input: RoleInput): Promise<RoleView> {
    await this.manablox.controls.assertFeature(spaceId, 'customRoles');
    const before = await this.get(spaceId, id);
    const data = this.validate(spaceId, input, before.permissions);
    return this.repos.transaction(async (tx) => {
      const row = await tx.roles
        .update(id, data)
        .catch(machineNameConflict({ machineName: input.machineName }));
      await this.audit
        .in(tx)
        .record('role.update', row, diffRecords(before, fromRow(row), { ignore: ['builtIn'] }));
      return fromRow(row);
    });
  }

  /** A role still held cannot be deleted. */
  async delete(spaceId: string, id: string): Promise<void> {
    await this.manablox.controls.assertFeature(spaceId, 'customRoles');
    const role = await this.get(spaceId, id);
    await this.repos.transaction(async (tx) => {
      const holders = await tx.roles.countMembers(spaceId, role.machineName);
      if (holders > 0) {
        throw ManabloxError.conflict('role.inUse', { name: role.name, count: holders });
      }
      await tx.roles.delete(id);
      await this.audit
        .in(tx)
        .record('role.delete', role, snapshotChanges(role, 'deleted', { ignore: ['builtIn'] }));
    });
  }

  /** Grants the creator's per-type role every action on a new type, while custom roles are on. */
  async grantContentType(spaceId: string, typeId: string, userId: string): Promise<void> {
    const held = await this.repos.users.findSpaceRole(userId, spaceId);
    if (!held || isBuiltInRole(held)) return;
    if (!(await this.manablox.controls.feature(spaceId, 'customRoles')).enabled) return;
    const row = await this.repos.roles.findByMachineName(spaceId, held);
    if (!row) return;

    const added = CONTENT_ACTIONS.map((action) => `content:${action}` as const)
      .filter((permission) => !row.permissions.includes(permission))
      .map((permission) => `${permission}:${typeId}`)
      .filter((grant) => !row.permissions.includes(grant));
    if (!added.length) return;

    await this.repos.transaction(async (tx) => {
      const saved = await tx.roles.update(row.id, {
        permissions: [...row.permissions, ...added],
      });
      await this.audit
        .in(tx)
        .record('role.grantContentType', saved, [
          { path: 'permissions', from: row.permissions, to: saved.permissions },
        ]);
    });
  }

  /** Drops grants naming a deleted type. */
  pruneContentType(typeId: string): Promise<void> {
    return this.repos.roles.pruneContentType(typeId);
  }

  /**
   * Validates the name and grants; `space:read` and `contentType:read` are always added. Unknown
   * grants in `stored`, such as a removed plugin's, are kept.
   */
  private validate(spaceId: string, input: RoleInput, stored: readonly string[] = []) {
    const collector = new ValidationCollector();

    if (!isMachineName(input.machineName)) {
      collector.add('role.machineName.invalid', ['machineName']);
    } else if (isBuiltInRole(input.machineName)) {
      collector.add('role.machineName.reserved', ['machineName'], {
        machineName: input.machineName,
      });
    }
    if (!input.name.trim()) collector.add('role.name.required', ['name']);

    const typeIds = new Set(this.manablox.contentTypes.forSpace(spaceId).map((type) => type.id));
    const { permissions, unknown } = normaliseGrants(input.permissions, typeIds, ALWAYS_GRANTED);
    for (const { index, grant } of unknown) {
      if (stored.includes(grant)) {
        permissions.push(grant);
        continue;
      }
      collector.add('role.permission.unknown', ['permissions', index], { permission: grant });
    }

    collector.throwIfAny('role.validation.failed');

    return {
      name: input.name.trim(),
      machineName: input.machineName,
      description: input.description?.trim() || null,
      permissions,
    };
  }
}

function builtIn(spaceId: string, role: (typeof BUILT_IN_ROLES)[number]): RoleView {
  const [name, description] = BUILT_IN_LABELS[role];
  return {
    id: null,
    spaceId,
    name,
    machineName: role,
    description,
    permissions: [...permissionsFor(role)],
    builtIn: true,
  };
}

function fromRow(row: RoleRow): RoleView {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    machineName: row.machineName,
    description: row.description,
    permissions: row.permissions,
    builtIn: false,
  };
}

/** Maps the `roles_space_machine_name_key` violation to a field error. */
const machineNameConflict = uniqueViolation({
  constraint: 'machine_name',
  key: 'role.machineName.taken',
  path: ['machineName'],
  errorKey: 'role.validation.failed',
});

export type { ContentAction };
export { ALWAYS_GRANTED };
