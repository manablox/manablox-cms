import { type AuditActor, auditor, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, UserRow } from '@manablox/db';
import type { AuthMailSender } from './mail-sender.js';
import { requestDetail } from './password-reset.js';
import { userAuditor } from './user.service.js';

/** Who must use two-factor authentication: nobody, everyone, or superadmins and space admins. */
export const TWO_FACTOR_POLICIES = ['off', 'all', 'admins'] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

/** Where the policy is stored in `instance_meta`. */
export const TWO_FACTOR_POLICY_KEY = 'auth.twoFactorPolicy';
/** Admin route where an account manages two-factor authentication. */
export const SECURITY_PATH = '/profile?tab=security';

/** How long a process trusts its copy of the stored policy. */
const POLICY_CACHE_MS = 5_000;

/** An account as the policy sees it. */
export interface TwoFactorSubject {
  role: string;
  /** Space id -> role name. */
  spaces: Record<string, string>;
}

export interface TwoFactorSettings {
  /** As stored by a superadmin. */
  policy: TwoFactorPolicy;
  /** `off` while the `twoFactor` feature is off. */
  effective: TwoFactorPolicy;
  /** The `twoFactor` feature: enrolment is possible. */
  available: boolean;
}

/** Whether a policy covers an account. */
export function policyCovers(policy: TwoFactorPolicy, subject: TwoFactorSubject): boolean {
  if (policy === 'all') return true;
  if (policy !== 'admins') return false;
  if (subject.role === 'superadmin') return true;
  return Object.values(subject.spaces).some((role) => role === 'owner' || role === 'admin');
}

const isPolicy = (value: unknown): value is TwoFactorPolicy =>
  (TWO_FACTOR_POLICIES as readonly unknown[]).includes(value);

/** The instance's two-factor policy, gated by the `twoFactor` feature, and its audit and mails. */
export class TwoFactorService {
  private cached: { policy: TwoFactorPolicy; at: number } | null = null;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly sender: AuthMailSender,
  ) {}

  /** Whether the `twoFactor` feature is on. */
  async available(): Promise<boolean> {
    return (await this.manablox.controls.feature(null, 'twoFactor')).enabled;
  }

  async settings(): Promise<TwoFactorSettings> {
    const [policy, available] = await Promise.all([this.storedPolicy(), this.available()]);
    return { policy, effective: available ? policy : 'off', available };
  }

  /** Refused with `auth.twoFactor.policyNeedsFeature` unless off, while the feature is off. */
  async setPolicy(policy: TwoFactorPolicy, actor?: AuditActor): Promise<TwoFactorSettings> {
    if (policy !== 'off' && !(await this.available())) {
      throw ManabloxError.badRequest('auth.twoFactor.policyNeedsFeature');
    }
    const before = await this.storedPolicy();
    await this.repos.instanceMeta.set(TWO_FACTOR_POLICY_KEY, policy);
    this.cached = { policy, at: Date.now() };
    if (before !== policy) {
      await auditor(this.repos, 'instance', () => 'Instance', actor ? { actor } : {}).record(
        'instance.updateSettings',
        { id: null },
        [{ path: 'twoFactorPolicy', from: before, to: policy }],
      );
    }
    return this.settings();
  }

  /** Whether an account without two-factor must enrol before anything else. */
  async pending(subject: TwoFactorSubject & { twoFactorEnabled: boolean }): Promise<boolean> {
    if (subject.twoFactorEnabled) return false;
    const { effective } = await this.settings();
    return policyCovers(effective, subject);
  }

  /** Whether the policy keeps an account from turning two-factor off. */
  async requiredFor(userId: string): Promise<boolean> {
    const principal = await this.repos.users.findPrincipal(userId);
    if (!principal) return false;
    const { effective } = await this.settings();
    return policyCovers(effective, principal);
  }

  /** Audits two-factor being turned on or off. */
  async changed(userId: string, enabled: boolean, headers?: Headers): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user) return;
    await userAuditor(this.repos, selfActor(user, headers)).record(
      enabled ? 'user.enableTwoFactor' : 'user.disableTwoFactor',
      user,
      [{ path: 'twoFactorEnabled', from: !enabled, to: enabled }],
    );
  }

  /** Audits new backup codes and tells the account by mail; a failed mail is logged. */
  async backupCodesRegenerated(userId: string, headers?: Headers): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user) return;
    await userAuditor(this.repos, selfActor(user, headers)).record(
      'user.regenerateBackupCodes',
      user,
      [],
    );
    try {
      if (!this.sender.enabled || !(await this.sender.allow(user.id))) return;
      await this.sender.send(user.email, {
        kind: 'backupCodes',
        name: user.name || user.email,
        at: new Date(),
        url: this.sender.page(SECURITY_PATH),
      });
    } catch (error) {
      this.manablox.logger.warn({ err: error, userId }, 'backup codes notice not sent');
    }
  }

  private async storedPolicy(): Promise<TwoFactorPolicy> {
    if (this.cached && Date.now() - this.cached.at < POLICY_CACHE_MS) return this.cached.policy;
    const stored = await this.repos.instanceMeta.get(TWO_FACTOR_POLICY_KEY);
    const policy = isPolicy(stored) ? stored : 'off';
    this.cached = { policy, at: Date.now() };
    return policy;
  }
}

/** The account itself, from the request it made. */
function selfActor(user: UserRow, headers: Headers | undefined): AuditActor {
  return { kind: 'user', id: user.id, label: user.email, detail: requestDetail(headers) };
}
