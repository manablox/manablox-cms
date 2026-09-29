import { createHash, randomBytes } from 'node:crypto';
import { type AuditActor, ManabloxError } from '@manablox/core';
import { type Manablox, systemActor } from '@manablox/core/node';
import { type Repositories, rethrowUniqueViolation, type UserRow } from '@manablox/db';
import type { AuthMailSender } from './mail-sender.js';
import { requestDetail } from './password-reset.js';
import { userAuditor } from './user.service.js';

/** Admin route that takes `?token=`. */
export const VERIFY_EMAIL_PATH = '/verify-email';
/** Lifetime of a confirmation link. */
export const VERIFY_EMAIL_SECONDS = 24 * 60 * 60;

/** The part of better-auth's adapter that stores and redeems tokens. */
interface VerificationStore {
  createVerificationValue(data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<unknown>;
  consumeVerificationValue(identifier: string): Promise<{ value: string } | null>;
}

interface Pending {
  userId: string;
  email: string;
}

export type EmailChangeResult = { status: 'sent'; email: string } | { status: 'changed' };

/**
 * One-time links that confirm an address: a changed one before it applies, and the current one
 * while `auth.requireEmailVerification` holds. Only a hash of each token is stored.
 */
export class EmailVerificationService {
  private store: (() => Promise<VerificationStore>) | null = null;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly sender: AuthMailSender,
  ) {}

  /** Whether confirmation mails can be sent. */
  get mailEnabled(): boolean {
    return this.sender.enabled;
  }

  /** Called by `createAuth`. */
  bind(auth: { $context: Promise<{ internalAdapter: VerificationStore }> }): void {
    this.store = async () => (await auth.$context).internalAdapter;
  }

  /** Whether unconfirmed accounts are kept from signing in; never without a transport. */
  async required(): Promise<boolean> {
    if (!this.sender.enabled) return false;
    const { settings } = await this.manablox.controls.resolved(null);
    return settings.authRequireEmailVerification;
  }

  /**
   * A self-service address change: mailed to the new address for confirmation, or applied at
   * once without a transport.
   */
  async requestChange(
    userId: string,
    email: string,
    headers?: Headers,
  ): Promise<EmailChangeResult> {
    const user = await this.require(userId);
    const next = email.trim().toLowerCase();
    if (next === user.email) {
      throw ManabloxError.validation(
        [{ key: 'user.email.same', path: ['email'] }],
        'user.validation.failed',
      );
    }
    if (await this.repos.users.findByEmail(next)) throw emailTaken(next);
    if (!this.sender.enabled) {
      await this.apply(user, next, actorOf(user, headers));
      return { status: 'changed' };
    }
    if (!(await this.sender.allow(user.id))) {
      throw ManabloxError.rateLimited('auth.mails.tooMany', { id: user.id });
    }
    await this.mail(user, next, true);
    await userAuditor(this.repos, actorOf(user, headers)).record('user.requestEmailChange', user, [
      { path: 'email', from: user.email, to: next },
    ]);
    return { status: 'sent', email: next };
  }

  /** Mails a link that confirms the current address; throttled and audited, never throws. */
  async sendConfirmation(userId: string, headers?: Headers): Promise<void> {
    try {
      const user = await this.repos.users.findById(userId);
      if (!user || user.emailVerified || !this.sender.enabled) return;
      if (!(await this.sender.allow(user.id))) return;
      await this.mail(user, user.email, false);
    } catch (error) {
      this.manablox.logger.warn(
        { err: error, userId, ...requestDetail(headers) },
        'email confirmation mail not sent',
      );
    }
  }

  /** Redeems a link; a changed address takes effect. */
  async confirm(token: string, headers?: Headers): Promise<{ email: string }> {
    const store = await this.requireStore();
    const row = await store.consumeVerificationValue(identifierOf(token));
    const pending = row ? parsePending(row.value) : null;
    if (!pending) throw ManabloxError.badRequest('auth.email.tokenInvalid');
    const user = await this.repos.users.findById(pending.userId);
    if (!user) throw ManabloxError.badRequest('auth.email.tokenInvalid');
    const actor = actorOf(user, headers);
    if (pending.email === user.email) {
      if (!user.emailVerified) {
        const updated = await this.repos.users.update(user.id, { emailVerified: true });
        await userAuditor(this.repos, actor).record('user.verifyEmail', updated, [
          { path: 'emailVerified', from: false, to: true },
        ]);
      }
      return { email: user.email };
    }
    await this.apply(user, pending.email, actor);
    return { email: pending.email };
  }

  private async apply(user: UserRow, email: string, actor: AuditActor): Promise<void> {
    const updated = await this.repos.users
      .update(user.id, { email, emailVerified: this.sender.enabled })
      .catch((error: unknown) =>
        rethrowUniqueViolation(error, {
          constraint: 'email',
          key: 'user.email.taken',
          path: ['email'],
          params: { email },
          errorKey: 'user.validation.failed',
        }),
      );
    await userAuditor(this.repos, actor).record('user.update', updated, [
      { path: 'email', from: user.email, to: email },
    ]);
  }

  private async mail(user: UserRow, email: string, change: boolean): Promise<void> {
    const store = await this.requireStore();
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + VERIFY_EMAIL_SECONDS * 1000);
    await store.createVerificationValue({
      identifier: identifierOf(token),
      value: JSON.stringify({ userId: user.id, email } satisfies Pending),
      expiresAt,
    });
    await this.sender.send(email, {
      kind: 'verifyEmail',
      name: user.name || user.email,
      email,
      change,
      url: this.sender.link(VERIFY_EMAIL_PATH, token),
      expiresAt,
    });
  }

  private async requireStore(): Promise<VerificationStore> {
    if (!this.store) throw new Error('EmailVerificationService is not bound to an auth instance.');
    return this.store();
  }

  private async require(userId: string): Promise<UserRow> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw ManabloxError.notFound('user.notFound', { id: userId });
    return user;
  }
}

function identifierOf(token: string): string {
  return `verify-email:${createHash('sha256').update(token).digest('hex')}`;
}

function parsePending(value: string): Pending | null {
  try {
    const parsed = JSON.parse(value) as Partial<Pending>;
    return typeof parsed.userId === 'string' && typeof parsed.email === 'string'
      ? { userId: parsed.userId, email: parsed.email }
      : null;
  } catch {
    return null;
  }
}

function emailTaken(email: string): ManabloxError {
  return ManabloxError.validation(
    [{ key: 'user.email.taken', path: ['email'], params: { email } }],
    'user.validation.failed',
  );
}

function actorOf(user: UserRow, headers: Headers | undefined): AuditActor {
  return headers
    ? { kind: 'user', id: user.id, label: user.email, detail: requestDetail(headers) }
    : systemActor('email confirmation');
}
