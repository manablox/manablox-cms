import {
  type PluginRouterOf,
  type PluginRpcContext,
  type PluginRpcKit,
  schemas,
} from '@manablox/api-rpc/plugin';
import { z } from 'zod';
import type { LicenseServices } from './services/index.js';

const key = z.object({ id: schemas.uuid });

/** The license service of a procedure's context. */
const service = (context: PluginRpcContext<LicenseServices>) => context.plugin.services.licenses;

/** Settings → Licenses, at `plugins.license`; instance-wide, so superadmins only. */
export const licenseRpc = ({ superadmin, superadminWrite }: PluginRpcKit<LicenseServices>) => ({
  /** The keys, the products the configured plugins sell, and the portal. */
  overview: superadmin.handler(({ context }) => service(context).overview()),

  /** Adds a key, stored encrypted beside the environment's, and activates it. */
  addKey: superadminWrite
    .input(z.object({ key: z.string().trim().min(1).max(200) }))
    .handler(({ input, context }) => service(context).addKey(input.key)),

  /** Removes a key added in the admin; the environment's are read-only. */
  removeKey: superadminWrite.input(key).handler(async ({ input, context }) => {
    await service(context).removeKey(input.id);
    return { ok: true as const };
  }),

  /** Refreshes a key's lease now; one without an activation is activated. */
  refresh: superadminWrite
    .input(key)
    .handler(({ input, context }) => service(context).refresh(input.id)),

  /** Activates a key again here, e.g. after a conflict or a deactivation. */
  activate: superadminWrite
    .input(key)
    .handler(({ input, context }) => service(context).activate(input.id)),

  /** Frees the key's activation on the license server; its products lock here. */
  deactivate: superadminWrite
    .input(key)
    .handler(({ input, context }) => service(context).deactivate(input.id)),
});

export type LicenseRouter = PluginRouterOf<typeof licenseRpc>;
