import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import type { SsoService } from '../sso.js';

const at =
  (path: string) =>
  (context: { path?: string | undefined }): boolean =>
    context.path === path;

const ssoRequired = () =>
  new APIError('FORBIDDEN', { message: 'auth.sso.required', code: 'SSO_REQUIRED' });

/**
 * The sign-in page's SSO endpoints, and the rules around better-auth's: `require SSO` refuses
 * password sign-in and resets for a provider's domains, and the `sso` feature gates SSO sign-in.
 */
export function ssoRules(service: SsoService) {
  const emailOf = (body: unknown): string | null => {
    const email = (body as { email?: unknown } | null)?.email;
    return typeof email === 'string' ? email : null;
  };
  const guardEmail = createAuthMiddleware(async (ctx) => {
    const email = emailOf(ctx.body);
    if (email && (await service.requiredFor(email))) throw ssoRequired();
  });
  return {
    id: 'manablox-sso',
    endpoints: {
      ssoSignInProviders: createAuthEndpoint(
        '/sso/sign-in-providers',
        { method: 'GET' },
        async (ctx) => ctx.json({ providers: await service.signInProviders() }),
      ),
      ssoLookup: createAuthEndpoint('/sso/lookup', { method: 'POST' }, async (ctx) => {
        const email = emailOf(ctx.body);
        const provider = email && email.length <= 320 ? await service.lookup(email) : null;
        return ctx.json({ provider });
      }),
    },
    hooks: {
      before: [
        { matcher: at('/sign-in/email'), handler: guardEmail },
        { matcher: at('/request-password-reset'), handler: guardEmail },
        {
          matcher: at('/reset-password'),
          handler: createAuthMiddleware(async (ctx) => {
            const token = (ctx.body as { token?: unknown } | null)?.token;
            if (typeof token !== 'string' || !token) return;
            const stored = await ctx.context.internalAdapter.findVerificationValue(
              `reset-password:${token}`,
            );
            if (!stored) return;
            const user = await ctx.context.internalAdapter.findUserById(stored.value);
            if (user && (await service.requiredFor(user.email))) throw ssoRequired();
          }),
        },
        {
          matcher: at('/sso/saml2/sp/acs/:providerId'),
          handler: createAuthMiddleware(async (ctx) => {
            await service.rememberAcs(await service.acsSettings(ctx.params?.providerId));
          }),
        },
        {
          matcher: at('/sign-in/sso'),
          handler: createAuthMiddleware(async () => {
            if (!(await service.available())) {
              throw new APIError('FORBIDDEN', { message: 'control.feature', code: 'FEATURE_OFF' });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
