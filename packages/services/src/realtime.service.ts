import {
  type NotificationEvent,
  type RealtimeEvent,
  type RealtimeEventSource,
  realtimeEventFrom,
} from '@manablox/core';
import { currentClient, type Manablox } from '@manablox/core/node';

export type RealtimeListener = (event: RealtimeEvent) => void;
export type NotificationListener = (event: NotificationEvent) => void;

/**
 * In-process live feed of audit entries for the SSE route. Nothing is stored; clients
 * refetch using `seq`. Single process only.
 */
export class RealtimeService {
  private readonly listeners = new Set<RealtimeListener>();
  private readonly notificationListeners = new Set<NotificationListener>();

  constructor(private readonly manablox: Manablox) {}

  /** A throwing listener is logged and the rest still run. */
  publish(event: RealtimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.manablox.logger.error({ err: error, eventId: event.id }, 'realtime listener failed');
      }
    }
  }

  /** An audit entry as an event, stamped with the originating tab. */
  publishAudit(row: RealtimeEventSource): void {
    this.publish(realtimeEventFrom(row, currentClient()));
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A new notification; the SSE route delivers it to the recipient only. */
  publishNotification(event: NotificationEvent): void {
    for (const listener of this.notificationListeners) {
      try {
        listener(event);
      } catch (error) {
        this.manablox.logger.error(
          { err: error, eventId: event.id },
          'notification listener failed',
        );
      }
    }
  }

  subscribeNotifications(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  get size(): number {
    return this.listeners.size;
  }
}
