import {
  type PluginRpcContext,
  type PluginRpcKit,
  payloadOf,
  schemas,
} from '@manablox/api-rpc/plugin';
import { hashPassword } from '@manablox/auth';
import { z } from 'zod';
import { SITE_LOCALE_STRATEGIES, SITE_MODES, type SpaceSiteSettings } from '../../shared/site.js';
import type { WebsiteServices } from '../services/index.js';
import { websiteFormsSecret } from '../services/site/options.js';

const { spaceScoped, uuid } = schemas;

/** Shortest site password accepted. */
const SITE_PASSWORD_MIN = 8;

/** The settings without the password hash, with the site origin the admin frames. */
function view(context: PluginRpcContext<WebsiteServices>, settings: SpaceSiteSettings) {
  const { password, ...site } = settings;
  const { config } = context.plugin.services;
  return {
    ...site,
    hasPassword: password !== null,
    siteUrl: config.url ?? null,
    // Whether this API accepts site form submissions.
    formsEnabled: websiteFormsSecret(config) !== null,
  };
}

/** A space's website settings. The rules are in `SiteSettingsService`. */
export const settingsProcedures = ({ scoped }: PluginRpcKit<WebsiteServices>) => ({
  /**
   * Designed or external site, locale strategy, 404 page, the design revision and whether a
   * site password is set, plus `siteUrl`, the site process origin the admin frames as the
   * design canvas.
   */
  get: scoped('space:read')
    .input(spaceScoped)
    .handler(async ({ context }) =>
      view(context, await context.plugin.services.settings.get(context.env)),
    ),

  /** `revision` is not writable; design publishes move it. `password: null` removes it. */
  set: scoped('space:write')
    .input(
      spaceScoped.extend({
        mode: z.enum(SITE_MODES).optional(),
        localeStrategy: z.enum(SITE_LOCALE_STRATEGIES).optional(),
        notFoundContentId: uuid.nullable().optional(),
        password: z.string().min(SITE_PASSWORD_MIN).max(200).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { password, ...data } = payloadOf(input);
      const passwordHash =
        password === undefined
          ? undefined
          : password === null
            ? null
            : await hashPassword(password);
      const saved = await context.plugin.services.settings.set(context.env, {
        ...data,
        ...(passwordHash !== undefined ? { passwordHash } : {}),
      });
      return view(context, saved);
    }),
});
