import { isEmailAddress, ManabloxError, RunError } from '@manablox/core';
import { accessTokenFor } from '@manablox/services';
import nodemailer from 'nodemailer';
import {
  defineWorkflowAction,
  type WorkflowActionContext,
  type WorkflowValidateAdd,
  type WorkflowValidatePath,
} from '../../define/action.js';
import { htmlToText } from '../html.js';
import { mailSent, noRecipient } from './shared.js';

/** Mail through the editor's own Gmail (API) or SMTP account; only the transport differs. */
export interface SendMailConfig extends Record<string, unknown> {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  html: boolean;
  /** Overrides the credential's address, where allowed. */
  from: string;
}

const mailFields = [
  {
    name: 'to',
    label: 'To',
    kind: 'stringList' as const,
    hint: 'One address per entry. Placeholders work.',
  },
  { name: 'cc', label: 'Cc', kind: 'stringList' as const },
  { name: 'subject', label: 'Subject', kind: 'template' as const, required: true },
  { name: 'body', label: 'Message', kind: 'templateArea' as const, rows: 10 },
  { name: 'html', label: 'The message is HTML', kind: 'switch' as const },
  {
    name: 'from',
    label: 'From',
    kind: 'template' as const,
    hint: "Leave empty to use the credential's own address.",
  },
];

const mailDefaults = (): SendMailConfig => ({
  to: [],
  cc: [],
  subject: '',
  body: '',
  html: false,
  from: '',
});

const validateMail = (
  config: SendMailConfig,
  at: WorkflowValidatePath,
  add: WorkflowValidateAdd,
): SendMailConfig => {
  const to = (config.to ?? []).map((address) => address.trim()).filter(Boolean);
  if (to.length === 0) add('plugins.workflows.node.email.recipientRequired', at('to'));
  for (const [index, address] of to.entries()) {
    if (!address.includes('{{') && !isEmailAddress(address)) {
      add('plugins.workflows.node.email.recipientInvalid', at('to', index), { address });
    }
  }
  if (!config.subject?.trim()) add('plugins.workflows.node.email.subjectRequired', at('subject'));
  return {
    to,
    cc: (config.cc ?? []).map((address) => address.trim()).filter(Boolean),
    subject: config.subject?.trim() ?? '',
    body: config.body ?? '',
    html: Boolean(config.html),
    from: config.from?.trim() ?? '',
  };
};

/** Rendered recipients of one field, split on common separators. */
function addresses(ctx: WorkflowActionContext<SendMailConfig>, templates: string[]): string[] {
  const out = new Set<string>();
  for (const template of templates) {
    for (const address of ctx.render(template).split(/[,\s;]+/)) {
      if (address && isEmailAddress(address)) out.add(address.toLowerCase());
    }
  }
  return [...out];
}

export const mailSendAction = defineWorkflowAction<SendMailConfig>({
  type: 'mail.send',
  label: 'Send from a mail account',
  description: 'Sends through an SMTP account you stored, not the instance mailer.',
  icon: 'send',
  tone: 'cyan',
  group: 'integration',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'What was sent', type: 'json' },
  outputPaths: [
    { path: 'to', type: 'json', hint: 'The addresses it went to' },
    { path: 'messageId', type: 'text', hint: "The mail server's id for it" },
  ],
  credential: { kinds: ['smtp'], required: true },
  fields: mailFields,
  defaults: mailDefaults,
  validate: validateMail,
  execute: async (ctx: WorkflowActionContext<SendMailConfig>) => {
    const credential = ctx.credential;
    if (!credential?.data.url) throw new ManabloxError('mail.notConfigured');
    const from = ctx.render(ctx.config.from).trim() || credential.data.from || '';
    if (!from) throw new ManabloxError('plugins.workflows.node.mail.fromRequired');

    const to = addresses(ctx, ctx.config.to);
    if (to.length === 0) throw noRecipient();
    const cc = addresses(ctx, ctx.config.cc);
    const subject = ctx.render(ctx.config.subject);
    const body = ctx.render(ctx.config.body);

    const transport = nodemailer.createTransport(credential.data.url);
    try {
      const info = await transport.sendMail({
        from,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        text: ctx.config.html ? htmlToText(body) : body,
        ...(ctx.config.html ? { html: body } : {}),
      });
      await mailSent(ctx, to.length + cc.length, 'account');
      return {
        kind: 'ok',
        message: `Sent to ${to.join(', ')}`,
        detail: { to, cc, subject, messageId: info.messageId ?? null },
        output: { to, cc, subject, messageId: info.messageId ?? null },
      };
    } finally {
      transport.close();
    }
  },
});

export const gmailSendAction = defineWorkflowAction<SendMailConfig>({
  type: 'gmail.send',
  label: 'Send with Gmail',
  description: 'Sends as a Google account through the Gmail API.',
  icon: 'mail',
  tone: 'pink',
  group: 'integration',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'What was sent', type: 'json' },
  outputPaths: [
    { path: 'to', type: 'json', hint: 'The addresses it went to' },
    { path: 'id', type: 'text', hint: "Gmail's id for the message" },
    { path: 'threadId', type: 'text', hint: 'The thread it landed in' },
  ],
  credential: { kinds: ['oauth2'], required: true },
  fields: mailFields,
  defaults: mailDefaults,
  validate: validateMail,
  execute: async (ctx: WorkflowActionContext<SendMailConfig>) => {
    const credential = ctx.credential;
    if (!credential) throw new ManabloxError('plugins.workflows.action.credentialRequired');
    const from = ctx.render(ctx.config.from).trim() || credential.data.from || 'me';

    const to = addresses(ctx, ctx.config.to);
    if (to.length === 0) throw noRecipient();
    const cc = addresses(ctx, ctx.config.cc);
    const subject = ctx.render(ctx.config.subject);
    const body = ctx.render(ctx.config.body);

    const token = await accessTokenFor(credential, ctx.fetch);
    ctx.secret(token);

    const raw = Buffer.from(
      [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: text/${ctx.config.html ? 'html' : 'plain'}; charset="UTF-8"`,
        '',
        body,
      ].join('\r\n'),
    ).toString('base64url');

    const response = await ctx.fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: ctx.signal,
      },
    );
    if (!response.ok) {
      const reason = (await response.text().catch(() => '')).slice(0, 300);
      throw new RunError(
        'plugins.workflows.run.serviceStatus',
        { service: 'Gmail', status: response.status, reason },
        `Gmail answered HTTP ${response.status}: ${reason}`,
      );
    }
    const sent = (await response.json()) as { id?: string; threadId?: string };
    await mailSent(ctx, to.length + cc.length, 'account');
    return {
      kind: 'ok',
      message: `Sent to ${to.join(', ')}`,
      detail: { to, cc, subject, id: sent.id ?? null },
      output: { to, cc, subject, id: sent.id ?? null, threadId: sent.threadId ?? null },
    };
  },
});

/** Encodes a non-ASCII subject as RFC 2047 base64. */
function encodeHeader(value: string): string {
  return /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
    : value;
}
