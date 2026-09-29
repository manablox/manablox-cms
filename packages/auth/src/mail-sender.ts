import type { Manablox } from '@manablox/core/node';
import { type AuthMailInput, authMail } from './mails.js';
import type { AuthMailer } from './password-reset.js';

/** Renders and sends auth mails, links into the admin and the `auth.mails` rate rule. */
export class AuthMailSender {
  constructor(
    private readonly manablox: Manablox,
    private readonly options: { mailer: AuthMailer | null; adminUrl: string },
  ) {}

  /** Whether a transport is configured. */
  get enabled(): boolean {
    return this.options.mailer !== null;
  }

  /** An admin route with `?token=`. */
  link(path: string, token: string): string {
    const base = this.options.adminUrl.replace(/\/$/, '');
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  /** An admin route without a token. */
  page(path: string): string {
    return `${this.options.adminUrl.replace(/\/$/, '')}${path}`;
  }

  /** Counts one auth mail for `key`; false past `rateLimits.auth.mails`. A failing store allows it. */
  async allow(key: string): Promise<boolean> {
    const decision = await this.manablox.controls.rate(null, [{ rule: 'auth.mails', key }]);
    return decision?.allowed ?? true;
  }

  /** Sends one mail; a no-op without a transport. */
  async send(to: string, input: AuthMailInput): Promise<void> {
    const mailer = this.options.mailer;
    if (!mailer) return;
    const { subject, text } = authMail(input);
    await mailer.send({ to: [to], subject, text });
  }
}
