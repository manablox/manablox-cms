import { randomBytes } from 'node:crypto';
import { type AuditActor, ManabloxError } from '@manablox/core';
import { type Manablox, systemActor } from '@manablox/core/node';
import type { Repositories, UserRow } from '@manablox/db';
import { authMail } from './mails.js';
import { userAuditor } from './user.service.js';

/** Satisfied by the workflows package's `Mailer`. */
export interface AuthMailer {
  send(message: { to: string[]; subject: string; text: string }): Promise<unknown>;
}

export interface PasswordResetOptions {
  /** `null` when no transport is configured: no mails, links only. */
  mailer: AuthMailer | null;
  /** Admin origin the links open. */
  adminUrl: string;
}

/** The part of better-auth's adapter that stores reset tokens. */
interface VerificationWriter {
  createVerificationValue(data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<unknown>;
}

export interface PasswordSetLink {
  url: string;
  expiresAt: Date;
}

/** Admin route that takes `?token=`. */
export const RESET_PASSWORD_PATH = '/reset-password';
/** Lifetime of a link requested with "forgot password". */
export const RESET_TOKEN_SECONDS = 60 * 60;
/** Default lifetime of a set-password link. */
export const SET_PASSWORD_LINK_SECONDS = 72 * 60 * 60;

/**
 * One-time links to the admin's reset page, as better-auth's `/reset-password` consumes them,
 * and the mails that carry them.
 */
export class PasswordResetService {
  private writer: (() => Promise<VerificationWriter>) | null = null;
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly options: PasswordResetOptions,
  ) {}

  /** Whether reset mails can be sent. */
  get mailEnabled(): boolean {
    return this.options.mailer !== null;
  }

  /** Called by `createAuth`. */
  bind(auth: { $context: Promise<{ internalAdapter: VerificationWriter }> }): void {
    this.writer = async () => (await auth.$context).internalAdapter;
  }

  /** A one-time link to set the password; valid for `expiresIn` seconds. */
  async createPasswordSetLink(
    userId: string,
    options: { expiresIn?: number } = {},
  ): Promise<PasswordSetLink> {
    const user = await this.require(userId);
    const link = await this.issue(user, options.expiresIn ?? SET_PASSWORD_LINK_SECONDS);
    await userAuditor(this.repos).record('user.requestPasswordReset', user, [], {
      delivery: 'link',
    });
    return link;
  }

  /**
   * Mails a set-password link. Throws `auth.mail.notConfigured` without a transport and
   * `auth.mails.tooMany` past `rateLimits.auth.mails`.
   */
  async sendPasswordSetMail(
    userId: string,
    options: { expiresIn?: number } = {},
  ): Promise<{ expiresAt: Date }> {
    const mailer = this.options.mailer;
    if (!mailer) throw ManabloxError.badRequest('auth.mail.notConfigured');
    const user = await this.require(userId);
    if (!(await this.allowMail(user.id))) {
      throw ManabloxError.rateLimited('auth.mails.tooMany', { id: user.id });
    }
    const link = await this.issue(user, options.expiresIn ?? SET_PASSWORD_LINK_SECONDS);
    await this.mail(mailer, user, 'setPassword', link);
    await userAuditor(this.repos).record('user.requestPasswordReset', user, [], {
      delivery: 'mail',
    });
    return { expiresAt: link.expiresAt };
  }

  /**
   * better-auth's `sendResetPassword`. Returns at once so the response time does not tell
   * whether the account exists; failures are logged.
   */
  onResetRequested(userId: string, token: string, headers?: Headers): Promise<void> {
    const run = this.sendReset(userId, token, headers).catch((error) =>
      this.manablox.logger.warn({ err: error, userId }, 'password reset mail not sent'),
    );
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
    return Promise.resolve();
  }

  /** better-auth's `onPasswordReset`. */
  async onPasswordReset(userId: string, headers?: Headers): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user) return;
    const actor: AuditActor = {
      kind: 'user',
      id: user.id,
      label: user.email,
      detail: requestDetail(headers),
    };
    await userAuditor(this.repos, actor).record('user.resetPassword', user, []);
  }

  /** Resolves once every reset mail started so far has been attempted. */
  async settle(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  private async sendReset(userId: string, token: string, headers?: Headers): Promise<void> {
    const mailer = this.options.mailer;
    const user = await this.repos.users.findById(userId);
    if (!mailer || !user || user.banned) return;
    const actor = systemActor('password reset', requestDetail(headers));
    if (!(await this.allowMail(user.id))) {
      await userAuditor(this.repos, actor).record('user.requestPasswordReset', user, [], {
        delivery: 'mail',
        throttled: true,
      });
      return;
    }
    const expiresAt = new Date(Date.now() + RESET_TOKEN_SECONDS * 1000);
    await this.mail(mailer, user, 'resetPassword', { url: this.link(token), expiresAt });
    await userAuditor(this.repos, actor).record('user.requestPasswordReset', user, [], {
      delivery: 'mail',
    });
  }

  private async issue(user: UserRow, expiresIn: number): Promise<PasswordSetLink> {
    if (!this.writer) throw new Error('PasswordResetService is not bound to an auth instance.');
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw ManabloxError.badRequest('request.invalid', { expiresIn });
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await (await this.writer()).createVerificationValue({
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt,
    });
    return { url: this.link(token), expiresAt };
  }

  private async mail(
    mailer: AuthMailer,
    user: UserRow,
    kind: 'resetPassword' | 'setPassword',
    link: PasswordSetLink,
  ): Promise<void> {
    const { subject, text } = authMail({ kind, name: user.name || user.email, ...link });
    await mailer.send({ to: [user.email], subject, text });
  }

  /** Counts one auth mail; false past `rateLimits.auth.mails`. A failing store allows it. */
  private async allowMail(userId: string): Promise<boolean> {
    const decision = await this.manablox.controls.rate(null, [{ rule: 'auth.mails', key: userId }]);
    return decision?.allowed ?? true;
  }

  private link(token: string): string {
    const base = this.options.adminUrl.replace(/\/$/, '');
    return `${base}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
  }

  private async require(userId: string): Promise<UserRow> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw ManabloxError.notFound('user.notFound', { id: userId });
    return user;
  }
}

/** Safe origin details of a request. */
export function requestDetail(headers: Headers | undefined): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (!headers) return detail;
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip');
  if (ip) detail.ip = ip;
  const userAgent = headers.get('user-agent');
  if (userAgent) detail.userAgent = userAgent.slice(0, 300);
  return detail;
}
