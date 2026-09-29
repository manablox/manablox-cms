import {
  type ControlScope,
  type FeatureControl,
  ManabloxError,
  type StateControl,
  scopeLabel,
} from '@manablox/core';
import type { Repositories, SpaceEnvironmentRow } from '@manablox/db';
import { ApiHostService } from '../api-host.service.js';
import type { EnvironmentDiff } from '../environments/diff.js';
import type {
  EnvironmentCreateInput,
  EnvironmentCreateResult,
  EnvironmentLifecycleService,
  EnvironmentPromoteResult,
} from '../environments/lifecycle.js';
import type { SnapshotManifest } from '../snapshots/layout.js';
import type {
  SnapshotRestoreMode,
  SnapshotRestoreResult,
  SnapshotService,
} from '../snapshots/service.js';
import type { ControlApiContext } from './api/context.js';
import { flattenControlSettings, parseGroupRef, spaceId, userId } from './api/input.js';
import { createOwnerAccount, passwordLink, provisionSpace } from './api/provision.js';
import { stateReport } from './api/state.js';
import type {
  ControlApiServices,
  ControlGroupView,
  ControlLinkOptions,
  ControlOwnerInput,
  ControlOwnerResult,
  ControlPasswordLink,
  ControlSpaceInput,
  ControlSpaceView,
  ControlStateReport,
  ControlUserView,
} from './api/types.js';
import { groupView, spaceView, userView } from './api/views.js';
import { type ControlEventView, controlEventView } from './delivery.js';
import type { ControlService, ControlSettings } from './service.js';
import {
  type ExternalUsageInput,
  type ExternalUsageResult,
  type UsageReport,
  UsageReports,
} from './usage-report.js';

export { flattenControlSettings, parseGroupRef } from './api/input.js';
export type * from './api/types.js';

/** Request-level control API logic over `ControlService`; the HTTP layer stays thin. */
export class ControlApi {
  private readonly ctx: ControlApiContext;
  private readonly usageReports: UsageReports;

  constructor(private readonly services: ControlApiServices) {
    this.usageReports = new UsageReports(services.manablox, services.repos);
    this.ctx = {
      ...services,
      apiHosts: services.apiHosts ?? new ApiHostService(services.manablox, services.repos),
    };
  }

  private get repos(): Repositories {
    return this.services.repos;
  }

  private get controls(): ControlService {
    return this.services.controls;
  }

  /** `instance`, `space:<id>`, `group:<id>` or `group:ext:<externalId>`; groups resolve to ids. */
  async scope(label: string): Promise<ControlScope> {
    if (label === 'instance') return { kind: 'instance' };
    const match = /^(group|space):(.+)$/.exec(label);
    if (!match?.[2]) throw ManabloxError.badRequest('control.scope.invalid', { scope: label });
    if (match[1] === 'space') return { kind: 'space', id: spaceId(match[2]) };
    return { kind: 'group', id: (await this.controls.group(parseGroupRef(match[2]))).id };
  }

  /** Stored values of one scope. */
  async settings(label: string): Promise<{ scope: string; settings: ControlSettings }> {
    const scope = await this.scope(label);
    return { scope: scopeLabel(scope), settings: await this.controls.settings(scope) };
  }

  allSettings(): Promise<Record<string, ControlSettings>> {
    return this.controls.allSettings();
  }

  /**
   * The features this process's plugin ceilings have off, by stored key (`features.<key>`).
   * Read-only: no scope label names them, so no write reaches them.
   */
  ceilings(): Record<string, FeatureControl> {
    const { features } = this.services.manablox.ceilings.current();
    return Object.fromEntries(
      [...features].map(([key, value]) => [`features.${key}`, { ...value }]),
    );
  }

  async replaceSettings(
    label: string,
    body: Record<string, unknown>,
  ): Promise<{ scope: string; settings: ControlSettings }> {
    const scope = await this.scope(label);
    const settings = await this.controls.replaceScope(scope, flattenControlSettings(body));
    await this.reevaluate();
    return { scope: scopeLabel(scope), settings };
  }

  async patchSettings(
    label: string,
    body: Record<string, unknown>,
  ): Promise<{ scope: string; settings: ControlSettings }> {
    const scope = await this.scope(label);
    const settings = await this.controls.patch(scope, flattenControlSettings(body));
    await this.reevaluate();
    return { scope: scopeLabel(scope), settings };
  }

  async deleteSetting(label: string, key: string): Promise<{ scope: string; removed: boolean }> {
    const scope = await this.scope(label);
    const removed = await this.controls.delete(scope, key);
    await this.reevaluate();
    return { scope: scopeLabel(scope), removed };
  }

  /** Sets the instance `state`; enforcement reads it from the resolved controls. */
  async setInstanceState(value: StateControl): Promise<StateControl> {
    return (await this.controls.set({ kind: 'instance' }, 'state', value)) as StateControl;
  }

  async listGroups(): Promise<ControlGroupView[]> {
    const groups = await this.controls.listGroups();
    return Promise.all(groups.map((group) => groupView(this.ctx, group)));
  }

  async group(ref: string): Promise<ControlGroupView> {
    return groupView(this.ctx, await this.controls.group(parseGroupRef(ref)));
  }

  async createGroup(data: {
    name: string;
    externalId?: string | null | undefined;
  }): Promise<ControlGroupView> {
    return groupView(this.ctx, await this.controls.createGroup(data));
  }

  async updateGroup(
    ref: string,
    data: { name?: string | undefined; externalId?: string | null | undefined },
  ): Promise<ControlGroupView> {
    const { name, externalId } = data;
    return groupView(
      this.ctx,
      await this.controls.updateGroup(parseGroupRef(ref), {
        ...(name !== undefined ? { name } : {}),
        ...(externalId !== undefined ? { externalId } : {}),
      }),
    );
  }

  async deleteGroup(ref: string): Promise<void> {
    await this.controls.deleteGroup(parseGroupRef(ref));
    await this.reevaluate();
  }

  /** Makes `spaceIds` the group's whole membership. */
  async setGroupSpaces(ref: string, spaceIds: string[]): Promise<ControlGroupView> {
    const groupRef = parseGroupRef(ref);
    await this.controls.assignSpaces(groupRef, spaceIds, { replace: true });
    await this.reevaluate();
    return groupView(this.ctx, await this.controls.group(groupRef));
  }

  async listSpaces(): Promise<ControlSpaceView[]> {
    const [spaces, groups, counts] = await Promise.all([
      this.repos.spaces.list(),
      this.repos.spaceGroups.list(),
      this.repos.spaces.counts(),
    ]);
    const byId = new Map(groups.map((group) => [group.id, group]));
    const apiHosts = await this.repos.spaceApiHosts.listBySpaces(spaces.map((space) => space.id));
    return Promise.all(
      spaces.map((space) => spaceView(this.ctx, space, byId, counts, apiHosts.get(space.id))),
    );
  }

  async space(id: string): Promise<ControlSpaceView> {
    const space = await this.repos.spaces.findById(spaceId(id));
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId: id });
    const group = space.groupId ? await this.repos.spaceGroups.findById(space.groupId) : null;
    return spaceView(
      this.ctx,
      space,
      new Map(group ? [[group.id, group]] : []),
      await this.repos.spaces.counts([space.id]),
    );
  }

  /**
   * Creates a space through `SpaceService.create`, owned by every superadmin. The starter
   * shares its transaction; the group is joined after it commits, before the plugins'
   * after-commit steps, whose failures come back as `warnings`.
   */
  async createSpace(input: ControlSpaceInput): Promise<ControlSpaceView & { warnings: string[] }> {
    const { id, warnings } = await provisionSpace(this.ctx, input);
    return { ...(await this.space(id)), warnings };
  }

  /** Makes the space's API hosts exactly `hostnames`. */
  async setApiHosts(id: string, hostnames: string[]): Promise<ControlSpaceView> {
    const space = await this.repos.spaces.findById(spaceId(id));
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId: id });
    await this.ctx.apiHosts.replace(space.id, hostnames);
    return this.space(space.id);
  }

  /**
   * Creates the superadmin without a usable password and makes it owner of every space; the
   * instance counts as provisioned from then on. Refused once any superadmin exists.
   */
  async createOwner(input: ControlOwnerInput): Promise<ControlOwnerResult> {
    const id = await createOwnerAccount(this.ctx, input);
    const link = await passwordLink(this.ctx, id, input);
    return { user: await this.user(id), ...link };
  }

  /** Every account, oldest first. */
  async listUsers(): Promise<ControlUserView[]> {
    return (await this.repos.users.listWithActivity()).map(userView);
  }

  async user(id: string): Promise<ControlUserView> {
    userId(id);
    const row = (await this.repos.users.listWithActivity()).find((user) => user.id === id);
    if (!row) throw ManabloxError.notFound('user.notFound', { id });
    return userView(row);
  }

  /** A new set-password link for an account; earlier links stay valid until they expire. */
  async resetLink(id: string, options: ControlLinkOptions = {}): Promise<ControlPasswordLink> {
    await this.user(id);
    return passwordLink(this.ctx, id, options);
  }

  /** Signs the account out everywhere. */
  async revokeSessions(id: string): Promise<void> {
    await this.services.users.revokeSessions(userId(id));
  }

  /** Usage of a scope in a period (default: the current one). */
  async usage(label: string, period?: string): Promise<UsageReport> {
    return this.usageReports.report(await this.scope(label), period);
  }

  /** Events after `seq`, oldest first; `next` is the `after` of the following page. */
  async events(after: number, limit: number): Promise<{ items: ControlEventView[]; next: number }> {
    const rows = await this.repos.controlEvents.listAfter(after, limit);
    return { items: rows.map(controlEventView), next: rows.at(-1)?.seq ?? after };
  }

  /** Takes a snapshot of the space now. */
  async createSnapshot(id: string): Promise<SnapshotManifest> {
    return this.snapshotService().create(spaceId(id), { trigger: 'manual' });
  }

  /** A space's snapshots, newest first; a deleted space's are listed until pruned. */
  async listSnapshots(id: string): Promise<SnapshotManifest[]> {
    return this.snapshotService().list(spaceId(id));
  }

  /** Restores a snapshot as a new space or in place of its space. */
  async restoreSnapshot(
    id: string,
    snapshot: string,
    mode: SnapshotRestoreMode,
  ): Promise<SnapshotRestoreResult> {
    return this.snapshotService().restore(spaceId(id), snapshot, { mode });
  }

  /** A space's environments, production first. */
  listEnvironments(id: string): Promise<SpaceEnvironmentRow[]> {
    return this.environmentService().list(spaceId(id));
  }

  /** Copies an environment of the space into a new staging one. */
  createEnvironment(id: string, input: EnvironmentCreateInput): Promise<EnvironmentCreateResult> {
    return this.environmentService().create(spaceId(id), input);
  }

  /** What promoting a staging environment would change in production. */
  diffEnvironment(
    id: string,
    machineName: string,
    mode: EnvironmentCreateInput['mode'],
  ): Promise<EnvironmentDiff> {
    return this.environmentService().diff(spaceId(id), machineName, mode);
  }

  /** Promotes a staging environment into production. */
  promoteEnvironment(
    id: string,
    machineName: string,
    mode: EnvironmentCreateInput['mode'],
    confirm: boolean,
  ): Promise<EnvironmentPromoteResult> {
    return this.environmentService().promote(spaceId(id), machineName, mode, { confirm });
  }

  /** Deletes a staging environment. */
  deleteEnvironment(id: string, machineName: string): Promise<void> {
    return this.environmentService().delete(spaceId(id), machineName);
  }

  private environmentService(): EnvironmentLifecycleService {
    const service = this.services.environmentLifecycle;
    if (!service) throw ManabloxError.badRequest('environment.unsupported');
    return service;
  }

  private snapshotService(): SnapshotService {
    const { snapshots } = this.services;
    if (!snapshots?.supported) throw ManabloxError.badRequest('snapshot.unsupported');
    return snapshots;
  }

  /** Stores an external usage figure once per idempotency key. */
  async externalUsage(input: ExternalUsageInput): Promise<ExternalUsageResult> {
    const result = await this.usageReports.external(input);
    if (!result.duplicate) await this.reevaluate();
    return result;
  }

  /** Usage levels follow the write; a failure leaves them to the next flush. */
  private async reevaluate(): Promise<void> {
    await this.services.usageState?.evaluate().catch((error: unknown) => {
      this.services.manablox.logger.warn({ err: error }, 'usage state not evaluated');
    });
  }

  /** Resolved state and switched-off features of the instance, every group and every space. */
  state(): Promise<ControlStateReport> {
    return stateReport(this.ctx);
  }
}
