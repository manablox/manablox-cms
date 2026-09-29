import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import type { EmailVerificationService } from './email-verification.js';
import type { TwoFactorService } from './two-factor.js';

export interface AccountPluginOptions {
  emails?: EmailVerificationService | undefined;
  twoFactor?: TwoFactorService | undefined;
}

const at =
  (path: string) =>
  (context: { path?: string | undefined }): boolean =>
    context.path === path;

/**
 * Manablox rules around better-auth's endpoints: unconfirmed addresses cannot sign in while
 * required, the `twoFactor` feature gates enrolment, the policy keeps two-factor on, and
 * two-factor changes are audited. Listed before the `twoFactor` plugin so it sees the session.
 */
export function accountPlugin({ emails, twoFactor }: AccountPluginOptions) {
  return {
    id: 'manablox-account',
    hooks: {
      before: [
        {
          matcher: at('/two-factor/enable'),
          handler: createAuthMiddleware(async () => {
            if (twoFactor && !(await twoFactor.available())) {
              throw new APIError('FORBIDDEN', { message: 'control.feature', code: 'FEATURE_OFF' });
            }
          }),
        },
        {
          matcher: at('/two-factor/disable'),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (session && twoFactor && (await twoFactor.requiredFor(session.user.id))) {
              throw new APIError('FORBIDDEN', {
                message: 'auth.twoFactor.required',
                code: 'TWO_FACTOR_REQUIRED',
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: at('/sign-in/email'),
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created || !emails || created.user.emailVerified) return;
            if (!(await emails.required())) return;
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(created.session.token);
            ctx.context.setNewSession(null);
            await emails.sendConfirmation(created.user.id, ctx.request?.headers);
            throw new APIError('FORBIDDEN', {
              message: 'auth.email.unverified',
              code: 'EMAIL_NOT_VERIFIED',
            });
          }),
        },
        {
          matcher: at('/two-factor/generate-backup-codes'),
          handler: createAuthMiddleware(async (ctx) => {
            const userId = ctx.context.session?.user.id;
            if (!twoFactor || !userId || isAPIError(ctx.context.returned)) return;
            await twoFactor.backupCodesRegenerated(userId, ctx.request?.headers);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
