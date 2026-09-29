import { errorFromBody } from './api-errors';

/** A refusal from better-auth; `code` is its error code, e.g. `INVALID_TOKEN`. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/** Calls better-auth's endpoints directly; the session is an httpOnly cookie. */
async function call<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The rate limit and brute-force guard answer `{ error }`; better-auth answers `{ message }`.
    if ((payload as { error?: unknown }).error) throw errorFromBody(payload, response.status);
    const { message, code } = payload as { message?: string; code?: string };
    throw new AuthError(message ?? 'auth.failed', code ?? null);
  }
  return payload as T;
}

/** An SSO provider as the sign-in page offers it. */
export interface SsoProvider {
  providerId: string;
  name: string;
}

/** A sign-in that still needs a second step answers `twoFactorRedirect`. */
export type SignInResult = { token: string } | { twoFactorRedirect: true };

export const auth = {
  signIn: (email: string, password: string) =>
    call<SignInResult>('sign-in/email', { email, password }),

  /** The second sign-in step with an authenticator code. */
  verifyTotp: (code: string, trustDevice = false) =>
    call<{ token: string }>('two-factor/verify-totp', { code, trustDevice }),

  /** The second sign-in step with a backup code; each code works once. */
  verifyBackupCode: (code: string) =>
    call<{ token: string }>('two-factor/verify-backup-code', { code }),

  /** Starts enrolment: the authenticator URI and the backup codes. */
  enableTwoFactor: (password: string) =>
    call<{ totpURI: string; backupCodes: string[] }>('two-factor/enable', { password }),

  /** Confirms enrolment with a first code. */
  confirmTwoFactor: (code: string) => call<{ token: string }>('two-factor/verify-totp', { code }),

  disableTwoFactor: (password: string) =>
    call<{ status: boolean }>('two-factor/disable', { password }),

  /** New backup codes; the old ones stop working. */
  generateBackupCodes: (password: string) =>
    call<{ backupCodes: string[] }>('two-factor/generate-backup-codes', { password }),

  signUp: (email: string, password: string, name: string) =>
    call<{ token: string }>('sign-up/email', { email, password, name }),

  signOut: () => call<unknown>('sign-out', {}),

  /** Answers the same whether or not the address has an account. */
  requestPasswordReset: (email: string) =>
    call<{ status: boolean }>('request-password-reset', { email }),

  /** Redeems a one-time link; every session of the account ends. */
  resetPassword: (token: string, newPassword: string) =>
    call<{ status: boolean }>('reset-password', { token, newPassword }),

  /** Starts SSO sign-in; answers the identity provider's address to open. */
  signInSso: (providerId: string, callbackURL: string, errorCallbackURL: string) =>
    call<{ url: string }>('sign-in/sso', { providerId, callbackURL, errorCallbackURL }),

  /** SSO providers listed on the sign-in page; none when unsure. */
  async ssoProviders(): Promise<SsoProvider[]> {
    try {
      const response = await fetch('/api/auth/sso/sign-in-providers', { credentials: 'include' });
      if (!response.ok) return [];
      return ((await response.json()) as { providers?: SsoProvider[] }).providers ?? [];
    } catch {
      return [];
    }
  },

  /** The SSO provider for an address, if one serves its domain; `null` when unsure. */
  async ssoLookup(email: string): Promise<(SsoProvider & { required: boolean }) | null> {
    try {
      return (
        await call<{ provider: (SsoProvider & { required: boolean }) | null }>('sso/lookup', {
          email,
        })
      ).provider;
    } catch {
      return null;
    }
  },

  /** Whether the instance can mail reset links; false when unsure. */
  async passwordResetEnabled(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/password-reset/status', { credentials: 'include' });
      if (!response.ok) return false;
      return ((await response.json()) as { enabled?: boolean }).enabled === true;
    } catch {
      return false;
    }
  },
};
