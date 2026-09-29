import {
  DEFAULT_MAIL_FROM,
  type GmailMailTransportConfig,
  isMailTransport,
  type MailgunMailTransportConfig,
  type MailTransport,
  type MailTransportInput,
  type MicrosoftMailTransportConfig,
  type PostmarkMailTransportConfig,
  type ResendMailTransportConfig,
  RunError,
  type SendgridMailTransportConfig,
  type SmtpMailTransportConfig,
} from '@manablox/core';
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import MailComposer from 'nodemailer/lib/mail-composer';
import { type AccessToken, requestAccessToken } from '../credentials/oauth.js';

/** Built-in mail transports. API ones use plain `fetch`, one request per message. */
export interface TransportOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export function createMailTransport(
  input: MailTransportInput,
  options: TransportOptions = {},
): MailTransport {
  if (isMailTransport(input)) return input;
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  switch (input.driver) {
    case 'smtp':
      return smtpTransport('smtp', smtpOptions(input));
    case 'mailpit':
      // Mailpit is unauthenticated and unencrypted.
      return smtpTransport('mailpit', {
        host: input.host ?? 'localhost',
        port: input.port ?? 1025,
        secure: false,
        ignoreTLS: true,
      });
    case 'gmail':
      return gmailTransport(input, http, now);
    case 'microsoft':
      return microsoftTransport(input, http, now);
    case 'resend':
      return resendTransport(input, http);
    case 'sendgrid':
      return sendgridTransport(input, http);
    case 'postmark':
      return postmarkTransport(input, http);
    case 'mailgun':
      return mailgunTransport(input, http);
  }
}

// --- SMTP -------------------------------------------------------------------------------

function smtpOptions(config: SmtpMailTransportConfig): string | Record<string, unknown> {
  if (config.url) return config.url;
  const secure = config.secure ?? false;
  return {
    host: config.host,
    port: config.port ?? (secure ? 465 : 587),
    secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
  };
}

function smtpTransport(name: string, options: string | Record<string, unknown>): MailTransport {
  const transport = nodemailer.createTransport(options as never);
  return {
    name,
    async send(message) {
      const info = await transport.sendMail({
        from: message.from ?? DEFAULT_MAIL_FROM,
        to: message.to,
        ...(message.cc?.length ? { cc: message.cc } : {}),
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return { id: info.messageId ?? null };
    },
    close: () => transport.close(),
  };
}

// --- Mailbox APIs -----------------------------------------------------------------------

/** Access token per client, reused until shortly before expiry. */
function tokenCache(
  fetchToken: () => Promise<AccessToken>,
  now: () => number,
): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return async () => {
    if (cached && cached.expiresAt > now() + 60_000) return cached.token;
    pending ??= fetchToken()
      .then(({ token, expiresIn }) => {
        cached = { token, expiresAt: now() + expiresIn * 1000 };
        return token;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

/** An OAuth token request whose failure reads like the provider's other failures. */
function oauthToken(
  http: typeof fetch,
  url: string,
  params: Record<string, string>,
  provider: string,
): Promise<AccessToken> {
  return requestAccessToken(http, url, params, async (response) => {
    if (response) return fail(provider, 'token request', response);
    throw new RunError('mail.tokenMissing', { provider }, `${provider} returned no access token`);
  });
}

function gmailTransport(
  config: GmailMailTransportConfig,
  http: typeof fetch,
  now: () => number,
): MailTransport {
  const token = tokenCache(
    () =>
      oauthToken(
        http,
        'https://oauth2.googleapis.com/token',
        {
          grant_type: 'refresh_token',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
        },
        'Google',
      ),
    now,
  );
  const user = encodeURIComponent(config.user ?? 'me');

  return {
    name: 'gmail',
    async send(message) {
      // Without a From header Gmail sends as the authorised account.
      const raw = await new MailComposer({
        ...(message.from ? { from: message.from } : {}),
        to: message.to,
        ...(message.cc?.length ? { cc: message.cc } : {}),
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      })
        .compile()
        .build();
      const response = await http(
        `https://gmail.googleapis.com/gmail/v1/users/${user}/messages/send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await token()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw: raw.toString('base64url') }),
        },
      );
      if (!response.ok) await fail('Gmail', 'send', response);
      const sent = (await response.json()) as { id?: string };
      return { id: sent.id ?? null };
    },
  };
}

function microsoftTransport(
  config: MicrosoftMailTransportConfig,
  http: typeof fetch,
  now: () => number,
): MailTransport {
  const token = tokenCache(
    () =>
      oauthToken(
        http,
        `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
        {
          grant_type: 'client_credentials',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        },
        'Microsoft',
      ),
    now,
  );
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  return {
    name: 'microsoft',
    async send(message) {
      // A From other than `sender` needs Send As rights.
      const from = message.from ? parseAddress(message.from) : null;
      const response = await http(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await token()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: message.html
                ? { contentType: 'HTML', content: message.html }
                : { contentType: 'Text', content: message.text },
              toRecipients: recipients(message.to),
              ...(message.cc?.length ? { ccRecipients: recipients(message.cc) } : {}),
              ...(from
                ? { from: { emailAddress: { address: from.address, ...nameOf(from) } } }
                : {}),
            },
            saveToSentItems: config.saveToSentItems ?? false,
          }),
        },
      );
      if (!response.ok) await fail('Microsoft Graph', 'sendMail', response);
      // Graph returns 202 with no message id.
      return { id: null };
    },
  };
}

// --- Transactional mail APIs ------------------------------------------------------------

function resendTransport(config: ResendMailTransportConfig, http: typeof fetch): MailTransport {
  return {
    name: 'resend',
    async send(message) {
      const response = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from ?? DEFAULT_MAIL_FROM,
          to: message.to,
          ...(message.cc?.length ? { cc: message.cc } : {}),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
      if (!response.ok) await fail('Resend', 'send', response);
      const sent = (await response.json()) as { id?: string };
      return { id: sent.id ?? null };
    },
  };
}

function sendgridTransport(config: SendgridMailTransportConfig, http: typeof fetch): MailTransport {
  const host = config.region === 'eu' ? 'api.eu.sendgrid.com' : 'api.sendgrid.com';
  const recipients = (list: string[]) => list.map((email) => ({ email }));
  return {
    name: 'sendgrid',
    async send(message) {
      const from = parseAddress(message.from ?? DEFAULT_MAIL_FROM);
      const response = await http(`https://${host}/v3/mail/send`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: recipients(message.to),
              ...(message.cc?.length ? { cc: recipients(message.cc) } : {}),
            },
          ],
          from: { email: from.address, ...nameOf(from) },
          subject: message.subject,
          // SendGrid wants text/plain before text/html.
          content: [
            { type: 'text/plain', value: message.text },
            ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
          ],
        }),
      });
      if (!response.ok) await fail('SendGrid', 'send', response);
      return { id: response.headers.get('x-message-id') };
    },
  };
}

function postmarkTransport(config: PostmarkMailTransportConfig, http: typeof fetch): MailTransport {
  return {
    name: 'postmark',
    async send(message) {
      const response = await http('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-postmark-server-token': config.serverToken,
        },
        body: JSON.stringify({
          From: message.from ?? DEFAULT_MAIL_FROM,
          To: message.to.join(', '),
          ...(message.cc?.length ? { Cc: message.cc.join(', ') } : {}),
          Subject: message.subject,
          TextBody: message.text,
          ...(message.html ? { HtmlBody: message.html } : {}),
          MessageStream: config.messageStream ?? 'outbound',
        }),
      });
      if (!response.ok) await fail('Postmark', 'send', response);
      const sent = (await response.json()) as { MessageID?: string };
      return { id: sent.MessageID ?? null };
    },
  };
}

function mailgunTransport(config: MailgunMailTransportConfig, http: typeof fetch): MailTransport {
  const host = config.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`;
  return {
    name: 'mailgun',
    async send(message) {
      const form = new URLSearchParams();
      form.append('from', message.from ?? DEFAULT_MAIL_FROM);
      for (const address of message.to) form.append('to', address);
      for (const address of message.cc ?? []) form.append('cc', address);
      form.append('subject', message.subject);
      form.append('text', message.text);
      if (message.html) form.append('html', message.html);

      const response = await http(
        `https://${host}/v3/${encodeURIComponent(config.domain)}/messages`,
        {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        },
      );
      if (!response.ok) await fail('Mailgun', 'send', response);
      const sent = (await response.json()) as { id?: string };
      return { id: sent.id ?? null };
    },
  };
}

// --- Helpers ----------------------------------------------------------------------------

/** Splits `Name <addr>` or a bare address into its parts. */
export function parseAddress(value: string): { name: string; address: string } {
  const [first] = addressparser(value, { flatten: true });
  return { name: first?.name ?? '', address: first?.address || value.trim() };
}

function nameOf(address: { name: string }): { name?: string } {
  return address.name ? { name: address.name } : {};
}

/** The provider's error text, trimmed. */
async function fail(provider: string, what: string, response: Response): Promise<never> {
  const reason = (await response.text().catch(() => '')).slice(0, 300);
  throw new RunError(
    'mail.serviceStatus',
    { service: `${provider} ${what}`, status: response.status, reason },
    `${provider} ${what} answered HTTP ${response.status}: ${reason}`,
  );
}
