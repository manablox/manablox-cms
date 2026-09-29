import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useQuery } from '@tanstack/vue-query';

export type TwoFactorPolicy = 'off' | 'all' | 'admins';

export const TWO_FACTOR_POLICIES: { value: TwoFactorPolicy; title: string; hint: string }[] = [
  { value: 'off', title: 'Optional', hint: 'Everyone decides for their own account.' },
  {
    value: 'admins',
    title: 'Required for administrators',
    hint: 'Instance administrators and space owners and admins must use it.',
  },
  { value: 'all', title: 'Required for everyone', hint: 'Every account must use it.' },
];

/** Instance settings the superadmin owns. */
export function useInstanceSettings() {
  return useQuery({ queryKey: keys.instance.settings(), queryFn: () => api.instance.settings() });
}

export const instanceSettings = {
  async setTwoFactorPolicy(twoFactorPolicy: TwoFactorPolicy) {
    const settings = await api.instance.updateSettings({ twoFactorPolicy });
    queryClient.setQueryData(keys.instance.settings(), settings);
    return settings;
  },
};

type CreateInput = Parameters<typeof api.sso.create>[0];
type UpdateInput = Parameters<typeof api.sso.update>[0];
export type SsoProvider = Awaited<ReturnType<typeof api.sso.list>>['providers'][number];
export type SsoTestResult = Awaited<ReturnType<typeof api.sso.test>>;

/** The instance's SSO providers and better-auth's base URL. */
export function useSsoProviders() {
  return useQuery({ queryKey: keys.instance.ssoProviders(), queryFn: () => api.sso.list() });
}

/** SSO provider writes, each with its invalidation. */
export const ssoProviders = {
  async create(input: CreateInput) {
    const created = await api.sso.create(input);
    invalidate.ssoProviders();
    return created;
  },
  async update(input: UpdateInput) {
    const updated = await api.sso.update(input);
    invalidate.ssoProviders();
    return updated;
  },
  async remove(id: string) {
    await api.sso.delete({ id });
    invalidate.ssoProviders();
  },
  async regenerateKeys(id: string) {
    const updated = await api.sso.regenerateKeys({ id });
    invalidate.ssoProviders();
    return updated;
  },
  test(input: Parameters<typeof api.sso.test>[0]) {
    return api.sso.test(input);
  },
};

/** The URLs an identity provider needs, for a provider id not saved yet too. */
export function ssoUrls(authBaseUrl: string, providerId: string) {
  const base = authBaseUrl.replace(/\/$/, '');
  const id = providerId || '<provider-id>';
  const metadata = `${base}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(id)}`;
  return {
    callback: `${base}/sso/callback/${id}`,
    acs: `${base}/sso/saml2/sp/acs/${id}`,
    metadata,
  };
}
