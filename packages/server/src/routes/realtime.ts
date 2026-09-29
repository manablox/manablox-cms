import { can, type Principal } from '@manablox/auth';
import { ManabloxError, type NotificationEvent, type RealtimeEvent } from '@manablox/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Runtime } from '../bootstrap.js';
import { principal, principalOf, resolveRequestPrincipal } from '../middleware/principal.js';

/** Keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

export interface RealtimeRouteOptions {
  /** Overridable for tests. */
  heartbeatMs?: number;
}

/** Space events reach readers of the space; instance events reach superadmins and the affected user. */
export function canHear(principal: Principal, event: RealtimeEvent): boolean {
  if (event.spaceId) return can(principal, event.spaceId, 'space:read');
  if (principal.role === 'superadmin' && !principal.allowedSpaceIds) return true;
  return (
    (event.targetKind === 'user' || event.targetKind === 'member') &&
    event.targetId === principal.userId
  );
}

/** SSE feed of visible changes. No replay; the admin refetches on reconnect. */
export function realtimeRoutes(runtime: Runtime, options: RealtimeRouteOptions = {}): Hono {
  const app = new Hono();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  app.get('/realtime/events', principal(runtime), async (c) => {
    // Re-resolved on every heartbeat so revoked access stops the stream.
    let caller = principalOf(c);
    if (!caller) throw ManabloxError.unauthorized();
    const userId = caller.userId;

    // Disable proxy buffering.
    c.header('x-accel-buffering', 'no');
    c.header('cache-control', 'no-cache, no-transform');

    return streamSSE(c, async (stream) => {
      let id = 0;
      let open = true;
      const queue: Promise<void>[] = [];

      const send = (event: RealtimeEvent): void => {
        if (!open || !caller || !canHear(caller, event)) return;
        queue.push(
          stream.writeSSE({ event: 'change', id: String(++id), data: JSON.stringify(event) }),
        );
      };
      const unsubscribe = runtime.realtime.subscribe(send);

      // Notifications go only to their recipient.
      const sendNotification = (event: NotificationEvent): void => {
        if (!open || event.userId !== caller?.userId) return;
        queue.push(
          stream.writeSSE({
            event: 'notification',
            id: String(++id),
            data: JSON.stringify(event),
          }),
        );
      };
      const unsubscribeNotifications = runtime.realtime.subscribeNotifications(sendNotification);

      let stop: () => void = () => {};
      const heartbeat = setInterval(() => {
        if (!open) return;
        queue.push(
          (async () => {
            let checked: typeof caller | undefined;
            try {
              checked = await resolveRequestPrincipal(runtime, c.req.raw.headers);
            } catch (error) {
              // A failed check keeps the session; the next heartbeat checks again.
              runtime.manablox.logger.warn({ err: error, userId }, 'realtime session check failed');
            }
            if (checked !== undefined) caller = checked;
            if (!caller) {
              // Tell the admin to sign out rather than reconnect.
              await stream.writeSSE({ event: 'expired', data: '' });
              stop();
              return;
            }
            await stream.writeSSE({ event: 'ping', data: '' });
          })(),
        );
      }, heartbeatMs);

      // Signals the stream is live; earlier changes are refetched.
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ userId }) });

      await new Promise<void>((finished) => {
        const done = () => {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          unsubscribe();
          unsubscribeNotifications();
          finished();
        };
        stop = done;
        stream.onAbort(done);
        c.req.raw.signal.addEventListener('abort', done);
      });
      await Promise.allSettled(queue);
    });
  });

  return app;
}
