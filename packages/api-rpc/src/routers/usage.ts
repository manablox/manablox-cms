import { assertCan } from '@manablox/auth';
import { UsageReports } from '@manablox/services';
import { authed, superadmin } from '../base.js';
import { spaceScoped } from '../schemas.js';

/** Usage against the usage limits the control API set, for the admin's usage page. */
export const usageRouter = {
  /** The space's meters, then its group's and the instance's that limit it; `space:write`. */
  space: authed.input(spaceScoped).handler(async ({ input, context }) => {
    // A read, so it stays open while the space imports.
    assertCan(context.principal, input.spaceId, 'space:write');
    return new UsageReports(context.manablox, context.repos).overview(input.spaceId);
  }),

  /** The instance's meters, then every space's. */
  instance: superadmin.handler(async ({ context }) =>
    new UsageReports(context.manablox, context.repos).overview(null),
  ),
};
