/** Mails the auth module sends, as plain text. */

interface LinkMail {
  /** The recipient's display name. */
  name: string;
  /** The one-time link. */
  url: string;
  expiresAt: Date;
}

/** Each mail kind with what it needs. */
interface AuthMails {
  resetPassword: LinkMail;
  setPassword: LinkMail;
  /** Confirms an address; `email` is the one being confirmed. */
  verifyEmail: LinkMail & { email: string; change: boolean };
  invite: {
    /** Who sent it. */
    inviter: string;
    /** Space names the invitation grants a role in. */
    spaces: string[];
    url: string;
    expiresAt: Date;
  };
  /** Sent when new backup codes replace the old ones. */
  backupCodes: { name: string; at: Date; url: string };
}

export type AuthMailKind = keyof AuthMails;

export type AuthMailInput = {
  [K in AuthMailKind]: { kind: K; locale?: string | undefined } & AuthMails[K];
}[AuthMailKind];

export interface AuthMailContent {
  subject: string;
  text: string;
}

type Templates = {
  [K in AuthMailKind]: (input: AuthMails[K] & { locale: string }) => AuthMailContent;
};

/** Per locale, like the admin's texts; `en` is the fallback. */
const TEMPLATES: Record<string, Templates> = {
  en: {
    resetPassword: ({ name, url, expiresAt, locale }) => ({
      subject: 'Reset your Manablox password',
      text: [
        `Hello ${name},`,
        '',
        'Someone asked to reset the password of your Manablox account. Open this link to choose a new one:',
        '',
        url,
        '',
        `The link works once and expires ${formatDate(expiresAt, locale)}.`,
        'If you did not ask for this, ignore this mail; your password stays as it is.',
      ].join('\n'),
    }),
    setPassword: ({ name, url, expiresAt, locale }) => ({
      subject: 'Set your Manablox password',
      text: [
        `Hello ${name},`,
        '',
        'A Manablox account was set up for you. Open this link to choose your password:',
        '',
        url,
        '',
        `The link works once and expires ${formatDate(expiresAt, locale)}.`,
      ].join('\n'),
    }),
    verifyEmail: ({ name, email, change, url, expiresAt, locale }) => ({
      subject: 'Confirm your email address',
      text: [
        `Hello ${name},`,
        '',
        change
          ? `Open this link to use ${email} for your Manablox account from now on:`
          : `Open this link to confirm ${email} for your Manablox account:`,
        '',
        url,
        '',
        `The link works once and expires ${formatDate(expiresAt, locale)}.`,
        'If you did not ask for this, ignore this mail; nothing changes.',
      ].join('\n'),
    }),
    invite: ({ inviter, spaces, url, expiresAt, locale }) => ({
      subject: `${inviter} invited you to Manablox`,
      text: [
        'Hello,',
        '',
        spaces.length > 0
          ? `${inviter} invited you to work in ${formatList(spaces, locale)} on Manablox.`
          : `${inviter} invited you to Manablox.`,
        'Open this link to accept and set up your account:',
        '',
        url,
        '',
        `The invitation works once and expires ${formatDate(expiresAt, locale)}.`,
        'If you did not expect it, ignore this mail.',
      ].join('\n'),
    }),
    backupCodes: ({ name, at, url, locale }) => ({
      subject: 'New two-factor backup codes for your Manablox account',
      text: [
        `Hello ${name},`,
        '',
        `New backup codes for two-factor authentication were created for your account ${formatDate(at, locale)}. The old codes no longer work.`,
        '',
        'If this was not you, change your password and check your security settings now:',
        '',
        url,
      ].join('\n'),
    }),
  },
};

export function authMail(input: AuthMailInput): AuthMailContent {
  const language = input.locale?.split('-')[0]?.toLowerCase() ?? 'en';
  const templates = TEMPLATES[language] ?? (TEMPLATES.en as Templates);
  const locale = TEMPLATES[language] ? language : 'en';
  const render = templates[input.kind] as (
    value: typeof input & { locale: string },
  ) => AuthMailContent;
  return render({ ...input, locale });
}

function formatDate(date: Date, locale: string): string {
  return `on ${date.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

function formatList(items: string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
}
