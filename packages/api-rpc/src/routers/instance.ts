import { TWO_FACTOR_POLICIES } from '@manablox/auth';
import { describePlugins } from '@manablox/core';
import { z } from 'zod';
import { authed, superadmin, superadminWrite } from '../base.js';

/** Instance settings the superadmin owns; control-set values stay with the control API. */
export const instanceRouter = {
  /** The loaded plugins with the labels of their permissions, controls and error keys. */
  plugins: authed.handler(({ context }) => describePlugins(context.manablox.config.plugins)),

  settings: superadmin.handler(async ({ context }) => ({
    twoFactor: await context.twoFactor.settings(),
  })),

  /** Requiring two-factor needs the `twoFactor` feature. */
  updateSettings: superadminWrite
    .input(z.object({ twoFactorPolicy: z.enum(TWO_FACTOR_POLICIES).optional() }))
    .handler(async ({ input, context }) => {
      if (input.twoFactorPolicy !== undefined) {
        await context.twoFactor.setPolicy(input.twoFactorPolicy);
      }
      return { twoFactor: await context.twoFactor.settings() };
    }),
};
