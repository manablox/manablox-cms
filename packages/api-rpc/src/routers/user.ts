import {
  assertCan,
  can,
  effectiveGrants,
  MIN_PASSWORD_LENGTH,
  normaliseGrants,
  type Principal,
} from '@manablox/auth';
import {
  type AdminBanner,
  type FeatureKey,
  ManabloxError,
  type ResolvedControls,
  type ResolvedFeature,
  type UsageMetric,
  type UsageNotice,
} from '@manablox/core';
import { z } from 'zod';
import { authed, base, superadmin, superadminWrite } from '../base.js';
import type { RpcContext } from '../context.js';
import { pagination, searchTerm, uuid } from '../schemas.js';

const instanceRole = z.enum(['superadmin', 'editor']);
const password = z.string().min(MIN_PASSWORD_LENGTH).max(200);
const email = z.string().email().max(320);
const displayName = z.string().trim().min(1).max(200);

/** A switched-off feature as the admin shows it. */
type FeatureOff = Omit<ResolvedFeature, 'enabled'>;

/** The switched-off features only; a missing key is on. */
function featuresOff(controls: ResolvedControls): Partial<Record<FeatureKey, FeatureOff>> {
  const off: Partial<Record<FeatureKey, FeatureOff>> = {};
  for (const [key, feature] of Object.entries(controls.features) as [
    FeatureKey,
    ResolvedFeature | undefined,
  ][]) {
    if (!feature || feature.enabled) continue;
    const { enabled: _enabled, ...rest } = feature;
    off[key] = rest;
  }
  return off;
}

/** Metrics that are not `ok`, for the admin's banner; groups are not named. */
function usageFlags(notices: Partial<Record<UsageMetric, UsageNotice>>) {
  const out: Partial<
    Record<
      UsageMetric,
      { level: UsageNotice['level']; resetsAt: string; scope: UsageNotice['scope']['kind'] }
    >
  > = {};
  for (const [metric, notice] of Object.entries(notices) as [UsageMetric, UsageNotice][]) {
    out[metric] = { level: notice.level, resetsAt: notice.resetsAt, scope: notice.scope.kind };
  }
  return out;
}

/**
 * The spaces the caller sees, and those whose controls can differ from the instance's (the
 * space or its group stores a value). Every other space resolves to the instance's controls.
 */
async function visibleSpaces(context: RpcContext & { principal: Principal }) {
  const { principal } = context;
  const allowed = principal.allowedSpaceIds;
  const stored = await context.repos.controlSettings.storedScopes();
  const spaces = new Set(stored.filter((scope) => scope.kind === 'space').map((scope) => scope.id));
  const groups = new Set(stored.filter((scope) => scope.kind === 'group').map((scope) => scope.id));
  const rows = (
    await context.spaces.list(
      principal.role === 'superadmin' ? null : Object.keys(principal.spaces),
    )
  ).filter((row) => !allowed || allowed.includes(row.id));
  return {
    all: rows.map((row) => row.id),
    controlled: new Set(
      rows
        .filter((row) => spaces.has(row.id) || (row.groupId !== null && groups.has(row.groupId)))
        .map((row) => row.id),
    ),
  };
}

/**
 * The controls the admin mirrors: instance flags, links, banners and state, plus per visible
 * space its flags and what it adds to the instance (state, banners, usage). A space whose
 * controls are the instance's has no entry (the admin reads the instance's for it), unless
 * it needs one to carry the instance's usage flags to whoever edits it.
 */
async function adminControls(context: RpcContext & { principal: Principal }) {
  const { principal } = context;
  const controls = context.manablox.controls;
  const audience = (banner: AdminBanner) =>
    banner.audience === 'all' || principal.role === 'superadmin';
  const allowed = principal.allowedSpaceIds;
  const visible = await visibleSpaces(context);

  const instance = await controls.resolved(null);
  const instanceOff = featuresOff(instance);
  const instanceUsage = usageFlags(await controls.usageNotices(null));
  // Shown at the top level to a superadmin; to anyone else through the spaces they edit.
  const instanceUsageShown = principal.role === 'superadmin' && !allowed;
  const spaces = await Promise.all(
    visible.all.map(async (spaceId) => {
      // The usage page's audience: superadmins and whoever edits the space's settings.
      const editor = can(principal, spaceId, 'space:write');
      if (!visible.controlled.has(spaceId)) {
        return !instanceUsageShown && editor && Object.keys(instanceUsage).length
          ? ([spaceId, { features: instanceOff, usage: instanceUsage }] as const)
          : null;
      }
      const resolved = await controls.resolved(spaceId);
      const banners = resolved.messages.banners
        .slice(instance.messages.banners.length)
        .filter(audience);
      const state = resolved.state.scope?.kind === 'instance' ? null : resolved.state;
      const usage = editor ? usageFlags(await controls.usageNotices(spaceId)) : {};
      return [
        spaceId,
        {
          features: featuresOff(resolved),
          ...(state && state.status !== 'active'
            ? { state: { status: state.status, message: state.message ?? null } }
            : {}),
          ...(banners.length ? { banners } : {}),
          ...(Object.keys(usage).length ? { usage } : {}),
        },
      ] as const;
    }),
  );
  return {
    features: instanceOff,
    links: instance.messages.links,
    banners: instance.messages.banners.filter(audience),
    state: { status: instance.state.status, message: instance.state.message ?? null },
    apiKeysDisable: instance.settings.apiKeysDisable,
    usage: instanceUsageShown ? instanceUsage : {},
    spaces: Object.fromEntries(spaces.filter((entry) => entry !== null)),
  };
}

/** The caller's two-factor state; `required` keeps it from being turned off. */
async function twoFactorState(context: RpcContext & { principal: Principal }, enabled: boolean) {
  const [settings, required] = await Promise.all([
    context.twoFactor.settings(),
    context.twoFactor.requiredFor(context.principal.userId),
  ]);
  return {
    enabled,
    available: settings.available,
    required,
    pending: context.principal.twoFactorPending === true,
  };
}

/** The caller's account and keys; every account for a superadmin. The rules are in `UserService`. */
export const userRouter = {
  me: authed.handler(async ({ context }) => {
    const user = await context.users.find(context.principal.userId);
    return user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          emailVerified: user.emailVerified,
          twoFactor: await twoFactorState(context, user.twoFactorEnabled),
          spaces: context.principal.spaces,
          // Space id -> resolved grants, the same table the server enforces. A superadmin
          // holds every grant everywhere, which the admin's `can` knows: no table.
          permissions:
            context.principal.role === 'superadmin'
              ? {}
              : Object.fromEntries(
                  Object.keys(context.principal.spaces).map((spaceId) => [
                    spaceId,
                    effectiveGrants(context.principal, spaceId),
                  ]),
                ),
          controls: await adminControls(context),
        }
      : null;
  }),

  /** Whether the instance has no account yet. Public; sign-up closes once one exists. */
  setupNeeded: base.handler(async ({ context }) => ({
    setupNeeded: await context.users.setupNeeded(),
  })),

  list: superadmin
    .input(
      z
        .object({ search: searchTerm.optional(), pagination: pagination({ limit: 25, max: 100 }) })
        .prefault({}),
    )
    .handler(async ({ input, context }) => context.users.list(input.pagination, input.search)),

  get: superadmin
    .input(z.object({ userId: uuid }))
    .handler(async ({ input, context }) => context.users.get(input.userId)),

  create: superadminWrite
    .input(
      z.object({
        name: displayName,
        email,
        password,
        role: instanceRole.default('editor'),
      }),
    )
    .handler(async ({ input, context }) => context.users.create(input)),

  update: superadminWrite
    .input(z.object({ userId: uuid, name: displayName.optional(), email: email.optional() }))
    .handler(async ({ input, context }) => {
      const { userId, ...data } = input;
      return context.users.update(userId, data);
    }),

  setRole: superadminWrite
    .input(z.object({ userId: uuid, role: instanceRole }))
    .handler(async ({ input, context }) => context.users.setRole(input.userId, input.role)),

  /** Resets a password and signs the account out everywhere. */
  setPassword: superadminWrite
    .input(z.object({ userId: uuid, password }))
    .handler(async ({ input, context }) => {
      await context.users.setPassword(input.userId, input.password);
      return { ok: true };
    }),

  ban: superadminWrite
    .input(z.object({ userId: uuid, reason: z.string().trim().max(500).optional() }))
    .handler(async ({ input, context }) =>
      context.users.ban(context.principal.userId, input.userId, input.reason || null),
    ),

  unban: superadminWrite
    .input(z.object({ userId: uuid }))
    .handler(async ({ input, context }) => context.users.unban(input.userId)),

  revokeSessions: superadminWrite
    .input(z.object({ userId: uuid }))
    .handler(async ({ input, context }) => {
      await context.users.revokeSessions(input.userId);
      return { ok: true };
    }),

  delete: superadminWrite.input(z.object({ userId: uuid })).handler(async ({ input, context }) => {
    await context.users.delete(context.principal.userId, input.userId);
    return { ok: true };
  }),

  /**
   * The caller's name and email; not the instance role. With mail, a new email waits for the
   * link sent to it (`emailChange`); without, it applies at once.
   */
  updateProfile: authed
    .input(z.object({ name: displayName.optional(), email: email.optional() }))
    .handler(async ({ input, context }) => {
      const userId = context.principal.userId;
      const current = await context.users.get(userId);
      if (input.name !== undefined) await context.users.update(userId, { name: input.name });
      const next = input.email?.trim().toLowerCase();
      const emailChange =
        next !== undefined && next !== current.email
          ? await context.emailVerification.requestChange(userId, next, context.headers)
          : null;
      const { memberships: _memberships, ...updated } = await context.users.get(userId);
      return { ...updated, emailChange };
    }),

  /** Redeems an email confirmation link. Public: the token is the credential. */
  verifyEmail: base
    .input(z.object({ token: z.string().min(16).max(200) }))
    .handler(async ({ input, context }) =>
      context.emailVerification.confirm(input.token, context.headers),
    ),

  /** Changes the caller's password. Other sessions stay signed in. */
  changePassword: authed
    .input(z.object({ currentPassword: z.string().min(1).max(200), password }))
    .handler(async ({ input, context }) => {
      await context.users.changePassword(
        context.principal.userId,
        input.currentPassword,
        input.password,
      );
      return { ok: true };
    }),

  apiKeys: authed.handler(async ({ context }) => context.apiKeys.list(context.principal.userId)),

  issueApiKey: authed
    .input(
      z.object({
        name: z.string().min(1).max(100),
        expiresAt: z.coerce.date().optional(),
        /** Empty or omitted issues an unrestricted key. */
        spaceIds: z.array(uuid).optional(),
        /** Grants the key is confined to; omitted means the owner's role. Only ever narrows. */
        permissions: z.array(z.string().max(120)).max(500).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await context.manablox.controls.assertFeature(null, 'apiKeys');
      // Only spaces the issuer can reach, so a restriction cannot probe others.
      for (const spaceId of input.spaceIds ?? []) {
        assertCan(context.principal, spaceId, 'space:read');
      }
      // A typed grant may name a type of any space the key will reach.
      const reachable = input.spaceIds?.length
        ? input.spaceIds
        : context.principal.role === 'superadmin'
          ? null
          : Object.keys(context.principal.spaces);
      const typeIds = new Set(
        (reachable
          ? reachable.flatMap((spaceId) => context.manablox.contentTypes.forSpace(spaceId))
          : context.manablox.contentTypes.all
        ).map((type) => type.id),
      );
      let permissions: string[] | null = null;
      if (input.permissions) {
        const checked = normaliseGrants(input.permissions, typeIds);
        if (checked.unknown.length) {
          throw ManabloxError.validation(
            checked.unknown.map(({ index, grant }) => ({
              key: 'role.permission.unknown' as const,
              path: ['permissions', index],
              params: { permission: grant },
            })),
            'apiKey.validation.failed',
          );
        }
        permissions = checked.permissions;
      }
      return context.apiKeys.issue(context.principal.userId, input.name, {
        expiresAt: input.expiresAt,
        spaceIds: input.spaceIds,
        permissions,
      });
    }),

  revokeApiKey: authed.input(z.object({ id: uuid })).handler(async ({ input, context }) => {
    // Only the caller's own keys.
    const own = await context.apiKeys.list(context.principal.userId);
    if (!own.some((key) => key.id === input.id)) return { ok: false };
    await context.apiKeys.revoke(input.id);
    return { ok: true };
  }),
};
