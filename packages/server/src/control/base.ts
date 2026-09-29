import { isExpectedError, TRANSPORT_CODE, toTransportError } from '@manablox/core';
import type { ControlApi } from '@manablox/services';
import { ORPCError, os } from '@orpc/server';
import type { ManagementRuntime } from '../bootstrap.js';

export interface ControlContext {
  api: ControlApi;
  runtime: ManagementRuntime;
}

/** Maps every expected error to the transport shape; details stay, the caller is trusted. */
export const base = os.$context<ControlContext>().use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (!isExpectedError(error)) throw error;
    const transport = toTransportError(error);
    throw new ORPCError(TRANSPORT_CODE[transport.kind], {
      status: transport.status,
      message: transport.message,
      data: transport,
      cause: error,
    });
  }
});
