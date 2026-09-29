import { ManabloxError, RunError } from '@manablox/core';
import { defineWorkflowAction, type WorkflowActionContext } from '../../define/action.js';

export interface PushConfig extends Record<string, unknown> {
  /** Members holding one of these roles. Empty, with no `userIds`, means every member. */
  roles: string[];
  userIds: string[];
  title: string;
  body: string;
  /** Click target; a template, absolute or relative to the admin. */
  url: string;
}

export const pushAction = defineWorkflowAction<PushConfig>({
  type: 'push',
  label: 'Send a push notification',
  description: 'To members who enabled notifications in the admin.',
  icon: 'bell',
  tone: 'pink',
  group: 'notify',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'What was sent', type: 'json' },
  outputPaths: [
    { path: 'sent', type: 'number', hint: 'Devices it reached' },
    { path: 'recipients', type: 'number', hint: 'People it was addressed to' },
  ],
  credential: null,
  fields: [
    { name: 'roles', label: 'Everyone with a role', kind: 'role' },
    { name: 'userIds', label: 'And these people', kind: 'user' },
    { name: 'title', label: 'Title', kind: 'template', required: true },
    { name: 'body', label: 'Text', kind: 'templateArea', rows: 3 },
    {
      name: 'url',
      label: 'Opens',
      kind: 'template',
      hint: 'A full URL, or a path inside the admin. Empty opens the document.',
    },
  ],
  isAvailable: (manablox) =>
    manablox.config.push.vapidPublicKey && manablox.config.push.vapidPrivateKey
      ? { ok: true }
      : { ok: false, reason: 'No VAPID key pair is configured for this instance.' },
  defaults: () => ({
    roles: [],
    userIds: [],
    title: '{{ content.title }}',
    body: '{{ event }} in {{ space.name }}',
    url: '',
  }),
  validate: (config, at, add) => {
    if (!config.title?.trim()) add('plugins.workflows.node.push.titleRequired', at('title'));
    return {
      roles: (config.roles ?? []).map((role) => role.trim()).filter(Boolean),
      userIds: (config.userIds ?? []).filter(Boolean),
      title: config.title?.trim() ?? '',
      body: config.body ?? '',
      url: config.url?.trim() ?? '',
    };
  },
  execute: async (ctx: WorkflowActionContext<PushConfig>) => {
    const pusher = ctx.services.pusher;
    if (!pusher) throw new ManabloxError('push.notConfigured');
    const repos = ctx.services.repos;

    const userIds = new Set(ctx.config.userIds);
    if (ctx.config.roles.length || userIds.size === 0) {
      const members = await repos.users.listMembersBySpace(ctx.run.space.id);
      for (const member of members) {
        if (ctx.config.roles.length === 0 || ctx.config.roles.includes(member.role)) {
          userIds.add(member.userId);
        }
      }
    }

    const subscriptions = await repos.pushSubscriptions.listByUsers([...userIds]);
    if (subscriptions.length === 0) {
      return {
        kind: 'ok',
        message: 'Nobody among the recipients has enabled notifications',
        detail: { recipients: userIds.size, devices: 0 },
        output: { recipients: userIds.size, devices: 0, sent: 0 },
      };
    }

    const rendered = ctx.render(ctx.config.url).trim();
    const url = rendered
      ? /^https?:\/\//i.test(rendered)
        ? rendered
        : `${ctx.adminUrl.replace(/\/$/, '')}/${rendered.replace(/^\//, '')}`
      : ctx.run.url;
    const payload = {
      title: ctx.render(ctx.config.title),
      body: ctx.render(ctx.config.body),
      url,
    };

    let sent = 0;
    let gone = 0;
    const failures: string[] = [];
    for (const subscription of subscriptions) {
      try {
        const result = await pusher.send(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          payload,
        );
        if (result === 'gone') {
          gone++;
          await repos.pushSubscriptions.delete(subscription.id);
        } else {
          sent++;
          await repos.pushSubscriptions.markUsed(subscription.id);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    const detail = {
      recipients: userIds.size,
      devices: subscriptions.length,
      sent,
      gone,
      failures,
    };
    if (sent === 0 && failures.length) {
      throw new RunError(
        'plugins.workflows.run.pushFailed',
        { reason: failures[0] },
        `Every push failed: ${failures[0]}`,
        { detail },
      );
    }
    return {
      kind: 'ok',
      message: `Sent to ${sent} device${sent === 1 ? '' : 's'}`,
      detail,
      output: detail,
    };
  },
});
