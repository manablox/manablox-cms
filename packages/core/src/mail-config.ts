import type { ValidationCollector } from './errors.js';
import {
  isMailTransport,
  MAIL_DRIVER_REQUIRED,
  MAIL_DRIVERS,
  type MailTransportInput,
} from './mail.js';

/**
 * Outgoing mail. Without a transport, email steps fail with `mail.notConfigured`
 * and notifications skip mail.
 */
export interface MailConfig {
  /** A built-in driver with its options, or a ready-made transport. */
  transport?: MailTransportInput;
  /**
   * The `From` header. Defaults to the mailbox for `gmail` and `microsoft`, otherwise
   * `Manablox <no-reply@localhost>`.
   */
  from?: string;
}

/** The mail config; `transport` is null when there is none. */
export interface ResolvedMailConfig {
  transport: MailTransportInput | null;
  from?: string;
}

export function resolveMail(mail: MailConfig | undefined): ResolvedMailConfig {
  return { transport: mail?.transport ?? null, ...(mail?.from ? { from: mail.from } : {}) };
}

/** A built-in driver the config names, with every option it cannot send without. */
export function validateMailTransport(
  transport: MailTransportInput | undefined,
  collector: ValidationCollector,
): void {
  if (!transport || isMailTransport(transport)) return;
  const path = ['mail', 'transport'];
  const driver = (transport as { driver?: unknown }).driver;
  if (typeof driver !== 'string' || !(MAIL_DRIVERS as readonly string[]).includes(driver)) {
    collector.add('config.mail.driverUnknown', [...path, 'driver'], {
      driver: String(driver),
      known: MAIL_DRIVERS.join(', '),
    });
    return;
  }
  const options = transport as unknown as Record<string, unknown>;
  const missing = [...MAIL_DRIVER_REQUIRED[transport.driver]];
  if (transport.driver === 'smtp' && !transport.url && !transport.host) missing.push('url');
  for (const option of missing) {
    if (option !== 'url' && options[option]) continue;
    collector.add('config.mail.optionMissing', [...path, option], { driver, option });
  }
}
