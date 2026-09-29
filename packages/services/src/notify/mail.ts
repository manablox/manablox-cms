import type { ResolvedMailConfig } from '@manablox/core';
import type { Logger } from '@manablox/core/node';
import { createMailTransport, type TransportOptions } from './mail-transports.js';

export interface MailMessage {
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string | null }>;
}

/**
 * A mailer over the configured transport, or `null`. Without a configured From, mailbox
 * transports send as their mailbox, others as `Manablox <no-reply@localhost>`.
 */
export function createMailer(
  config: ResolvedMailConfig,
  logger: Logger,
  options: TransportOptions = {},
): Mailer | null {
  if (!config.transport) return null;
  const transport = createMailTransport(config.transport, options);

  return {
    async send(message) {
      const sent = await transport.send({ ...message, from: config.from });
      logger.debug({ to: message.to, messageId: sent.id, transport: transport.name }, 'mail sent');
      return sent;
    },
  };
}
