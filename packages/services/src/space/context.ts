import { auditor, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceRow, TransactionRepositories } from '@manablox/db';
import type { SpaceConfigService } from '../config/service.js';
import type { RoleService } from '../role.service.js';
import type { SpaceTransferService } from '../transfer/service.js';

type SpaceTarget = { id: string; name: string | null };
type MemberTarget = { id: string; spaceId: string; label: string };

/** What the parts of `SpaceService` share. */
export class SpaceContext {
  readonly audit;
  readonly memberAudit;

  constructor(
    readonly manablox: Manablox,
    readonly repos: Repositories,
    /** Whether a role exists in a space. */
    readonly roles: RoleService,
    /** Exports, imports and their files. */
    readonly transfer: SpaceTransferService,
    /** The space's model as config code. */
    readonly config: SpaceConfigService,
  ) {
    this.audit = auditor(repos, 'space', (space: SpaceTarget) => space.name, {
      spaceId: (space) => space.id,
    });
    this.memberAudit = auditor(repos, 'member', (member: MemberTarget) => member.label);
  }

  async require(spaceId: string): Promise<SpaceRow> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    return space;
  }

  /** `space.created` or `space.deleted`, in the write's transaction. */
  spaceEvent(
    type: 'space.created' | 'space.deleted',
    space: SpaceRow,
    tx: TransactionRepositories,
  ): Promise<void> {
    return this.manablox.controls.emit(
      type,
      { kind: 'space', id: space.id },
      {
        spaceId: space.id,
        name: space.name,
        machineName: space.machineName,
        groupId: space.groupId ?? null,
      },
      { tx },
    );
  }
}
