import type { PushConfig } from '@manablox/core';
import type { Logger } from '@manablox/core/node';
import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Notification payload, as the admin service worker reads it. */
export interface PushPayload {
  title: string;
  body: string;
  url: string | null;
}

export interface Pusher {
  /** `gone`: the subscription is dead and its row should be deleted. */
  send(target: PushTarget, payload: PushPayload): Promise<'sent' | 'gone'>;
  publicKey: string;
}

export function isPushConfigured(config: PushConfig): boolean {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey);
}

/** Web Push sender, or `null` without VAPID keys (`manablox push-keys`). */
export function createPusher(config: PushConfig, logger: Logger): Pusher | null {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return null;
  const subject = config.subject ?? 'mailto:admin@localhost';
  const publicKey = config.vapidPublicKey;
  const privateKey = config.vapidPrivateKey;

  return {
    publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification(target, JSON.stringify(payload), {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 60 * 60 * 24,
        });
        return 'sent';
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          logger.debug({ endpoint: target.endpoint }, 'push subscription gone');
          return 'gone';
        }
        throw error;
      }
    },
  };
}

/** A fresh VAPID key pair. */
export function generatePushKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
