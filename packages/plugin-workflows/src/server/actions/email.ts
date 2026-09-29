import { isEmailAddress, ManabloxError } from '@manablox/core';
import { defineWorkflowAction, type WorkflowActionContext } from '../../define/action.js';
import { htmlToText } from '../html.js';
import { mailSent, noRecipient } from './shared.js';

export interface EmailConfig extends Record<string, unknown> {
  /** Addresses; each may be a template such as `{{ actor.email }}`. */
  to: string[];
  /** Space members with any of these roles are recipients too. */
  toRoles: string[];
  subject: string;
  body: string;
  html: boolean;
}

export const emailAction = defineWorkflowAction<EmailConfig>({
  type: 'email',
  label: 'Send an email',
  description: 'To addresses you name, or to members by role.',
  icon: 'mail',
  tone: 'cyan',
  group: 'notify',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'What was sent', type: 'json' },
  outputPaths: [
    { path: 'to', type: 'json', hint: 'The addresses it went to' },
    { path: 'subject', type: 'text', hint: 'The rendered subject' },
    { path: 'messageId', type: 'text', hint: "The mail server's id for it" },
  ],
  credential: null,
  fields: [
    {
      name: 'to',
      label: 'To',
      kind: 'stringList',
      hint: 'One address per entry. Placeholders work: {{ actor.email }}.',
    },
    { name: 'toRoles', label: 'And every member with a role', kind: 'role' },
    { name: 'subject', label: 'Subject', kind: 'template', required: true },
    { name: 'body', label: 'Message', kind: 'templateArea', rows: 8 },
    { name: 'html', label: 'The message is HTML', kind: 'switch' },
  ],
  isAvailable: (manablox) =>
    manablox.config.mail.transport
      ? { ok: true }
      : { ok: false, reason: 'No mail transport is configured for this instance.' },
  defaults: () => ({
    to: [],
    toRoles: [],
    subject: '{{ content.title }} was {{ event }}',
    body: '"{{ content.title }}" changed in {{ space.name }}.\n\n{{ url }}',
    html: false,
  }),
  validate: (config, at, add) => {
    const to = (config.to ?? []).map((address) => address.trim()).filter(Boolean);
    const toRoles = (config.toRoles ?? []).map((role) => role.trim()).filter(Boolean);
    if (to.length === 0 && toRoles.length === 0) {
      add('plugins.workflows.node.email.recipientRequired', at('to'));
    }
    for (const [index, address] of to.entries()) {
      // Templates are checked once rendered.
      if (!address.includes('{{') && !isEmailAddress(address)) {
        add('plugins.workflows.node.email.recipientInvalid', at('to', index), { address });
      }
    }
    if (!config.subject?.trim()) add('plugins.workflows.node.email.subjectRequired', at('subject'));
    return {
      to,
      toRoles,
      subject: config.subject?.trim() ?? '',
      body: config.body ?? '',
      html: Boolean(config.html),
    };
  },
  execute: async (ctx: WorkflowActionContext<EmailConfig>) => {
    const mailer = ctx.services.mailer;
    if (!mailer) throw new ManabloxError('mail.notConfigured');
    await ctx.manablox.controls.assertUsage(ctx.run.space.id, 'mails');

    const recipients = new Set<string>();
    for (const template of ctx.config.to) {
      for (const address of ctx.render(template).split(/[,\s;]+/)) {
        if (address && isEmailAddress(address)) recipients.add(address.toLowerCase());
      }
    }
    if (ctx.config.toRoles.length) {
      const members = await ctx.services.repos.users.listMembersBySpace(ctx.run.space.id);
      for (const member of members) {
        if (ctx.config.toRoles.includes(member.role) && member.user.email) {
          recipients.add(member.user.email.toLowerCase());
        }
      }
    }
    if (recipients.size === 0) throw noRecipient();

    const subject = ctx.render(ctx.config.subject);
    const body = ctx.render(ctx.config.body);
    const to = [...recipients];
    const sent = await mailer.send({
      to,
      subject,
      text: ctx.config.html ? htmlToText(body) : body,
      ...(ctx.config.html ? { html: body } : {}),
    });
    await mailSent(ctx, to.length, 'instance');
    return {
      kind: 'ok',
      message: `Sent to ${to.join(', ')}`,
      detail: { to, subject, messageId: sent.id },
      output: { to, subject, messageId: sent.id },
    };
  },
});
