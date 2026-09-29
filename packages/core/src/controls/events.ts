import type { ControlScope } from './types.js';

/** Events the CMS reports to the external layer, pulled or pushed from the outbox. */
export const CONTROL_EVENT_TYPES = [
  'usage.threshold',
  'limit.exceeded',
  'limit.blocked',
  'feature.denied',
  'space.created',
  'space.deleted',
  'space.groupChanged',
  'user.created',
  'user.deleted',
  'seat.changed',
  'domain.added',
  'domain.verified',
  'domain.removed',
  'snapshot.completed',
  'snapshot.failed',
  'snapshot.restored',
  'environment.created',
  'environment.promoted',
  'environment.deleted',
  'instance.stateChanged',
] as const;

export type ControlEventType = (typeof CONTROL_EVENT_TYPES)[number];

/** The outbox of an open transaction, e.g. the repositories `repos.transaction` hands out. */
export interface ControlEventOutbox {
  controlEvents: {
    append(input: {
      type: string;
      scope: ControlScope;
      payload?: Record<string, unknown> | undefined;
    }): Promise<unknown>;
  };
}

export interface ControlEmitOptions {
  /** Writes the event in this transaction, so it commits or rolls back with its cause. */
  tx?: ControlEventOutbox | undefined;
}
