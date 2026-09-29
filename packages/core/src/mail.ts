/** Mail transports: one per instance, a built-in driver or a custom `MailTransport`. */

/** The `From` header when neither the config nor the transport's mailbox supplies one. */
export const DEFAULT_MAIL_FROM = 'Manablox <no-reply@localhost>';

export const MAIL_DRIVERS = [
  'smtp',
  'mailpit',
  'gmail',
  'microsoft',
  'resend',
  'sendgrid',
  'postmark',
  'mailgun',
] as const;

export type MailDriver = (typeof MAIL_DRIVERS)[number];

/** Any SMTP server, by URL or by its parts. */
export interface SmtpMailTransportConfig {
  driver: 'smtp';
  /** `smtp://user:pass@host:587`, `smtps://...`, as nodemailer accepts. */
  url?: string;
  /** The parts, instead of a URL. */
  host?: string;
  /** Defaults to 465 with `secure`, 587 without. */
  port?: number;
  /** Implicit TLS; otherwise STARTTLS. */
  secure?: boolean;
  user?: string;
  password?: string;
}

/** Mailpit's SMTP port. Development only. */
export interface MailpitMailTransportConfig {
  driver: 'mailpit';
  /** Defaults to `localhost`. */
  host?: string;
  /** Defaults to 1025. */
  port?: number;
}

/** A Google mailbox over the Gmail API, with a `gmail.send` refresh token. */
export interface GmailMailTransportConfig {
  driver: 'gmail';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The mailbox to send as. Defaults to `me`, the account the refresh token belongs to. */
  user?: string;
}

/** A Microsoft 365 mailbox over Graph `sendMail`, as an app with `Mail.Send`. */
export interface MicrosoftMailTransportConfig {
  driver: 'microsoft';
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The mailbox that sends: its address or object id. Also the default `From`. */
  sender: string;
  /** Keep a copy in the mailbox's Sent Items. Defaults to false. */
  saveToSentItems?: boolean;
}

export interface ResendMailTransportConfig {
  driver: 'resend';
  apiKey: string;
}

export interface SendgridMailTransportConfig {
  driver: 'sendgrid';
  apiKey: string;
  /** `eu` for an account on SendGrid's EU data residency. Defaults to `global`. */
  region?: 'global' | 'eu';
}

export interface PostmarkMailTransportConfig {
  driver: 'postmark';
  serverToken: string;
  /** Defaults to `outbound`, the server's transactional stream. */
  messageStream?: string;
}

export interface MailgunMailTransportConfig {
  driver: 'mailgun';
  apiKey: string;
  /** The sending domain configured in Mailgun. */
  domain: string;
  /** `eu` for a domain in Mailgun's EU region. Defaults to `us`. */
  region?: 'us' | 'eu';
}

export type MailTransportConfig =
  | SmtpMailTransportConfig
  | MailpitMailTransportConfig
  | GmailMailTransportConfig
  | MicrosoftMailTransportConfig
  | ResendMailTransportConfig
  | SendgridMailTransportConfig
  | PostmarkMailTransportConfig
  | MailgunMailTransportConfig;

/** One message as it leaves the instance. */
export interface OutgoingMail {
  /** Absent when the config names no sender; a mailbox transport then sends as itself. */
  from?: string | undefined;
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
}

/** A custom transport. `send` resolves with the provider's message id, if any. */
export interface MailTransport {
  /** For logs: `resend`, `my-provider`. */
  readonly name: string;
  send(message: OutgoingMail): Promise<{ id: string | null }>;
  close?(): void | Promise<void>;
}

export type MailTransportInput = MailTransportConfig | MailTransport;

export function isMailTransport(input: unknown): input is MailTransport {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as MailTransport).send === 'function'
  );
}

/** Required options per driver. `smtp`'s url-or-host rule is checked separately. */
export const MAIL_DRIVER_REQUIRED: Record<MailDriver, readonly string[]> = {
  smtp: [],
  mailpit: [],
  gmail: ['clientId', 'clientSecret', 'refreshToken'],
  microsoft: ['tenantId', 'clientId', 'clientSecret', 'sender'],
  resend: ['apiKey'],
  sendgrid: ['apiKey'],
  postmark: ['serverToken'],
  mailgun: ['apiKey', 'domain'],
};
