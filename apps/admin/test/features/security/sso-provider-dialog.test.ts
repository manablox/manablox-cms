import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const api = vi.hoisted(() => ({
  sso: {
    create: vi.fn(),
    update: vi.fn(() => Promise.resolve({})),
    regenerateKeys: vi.fn(() =>
      Promise.resolve({ saml: { spCertificate: 'NEW CERT', spCertificateExpiresAt: null } }),
    ),
    test: vi.fn(),
  },
}));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api }));
vi.mock('@manablox/admin-sdk/lib/confirm', () => ({ confirm: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ spaces: [] }) }));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({ revalidate: vi.fn() }),
}));

import SsoProviderDialog from '~/features/security/components/SsoProviderDialog.vue';
import type { SsoProvider } from '~/features/security/queries';

const Dialog = defineComponent({
  setup(_props, { slots, expose }) {
    expose({ requestClose: () => {} });
    return () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })];
  },
});

const provider = {
  id: '00000000-0000-4000-8000-000000000001',
  providerId: 'corp',
  name: 'Corp',
  protocol: 'saml',
  domains: ['corp.test'],
  oidc: null,
  saml: {
    entryPoint: 'https://idp.test/sso',
    certificate: 'IDP CERT',
    certificateExpiresAt: null,
    idpEntityId: 'https://idp.test',
    spEntityId: 'https://api.test/metadata',
    emailAttribute: null,
    nameAttribute: null,
    signRequests: true,
    encryptAssertions: false,
    idpInitiated: false,
    landingPath: '/',
    spCertificate: 'OLD CERT',
    spCertificateExpiresAt: new Date('2036-01-01'),
  },
  requireSso: false,
  showOnSignIn: false,
  createAccounts: true,
  defaultGrants: [],
  urls: { callback: null, acs: null, metadata: null, spEntityId: null },
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as SsoProvider;

const mountDialog = () =>
  mount(SsoProviderDialog, {
    props: { provider, authBaseUrl: 'https://api.test/api/auth' },
    global: { stubs: { Dialog } },
  });

const switchFor = (wrapper: ReturnType<typeof mountDialog>, text: string) => {
  const label = wrapper.findAll('label').find((entry) => entry.text().startsWith(text));
  if (!label) throw new Error(`No switch ${text}`);
  return label.get('[role="switch"]');
};

describe('SsoProviderDialog', () => {
  it('edits the SAML options and sends them with the landing path', async () => {
    const wrapper = mountDialog();
    expect(switchFor(wrapper, 'Sign authentication requests').attributes('aria-checked')).toBe(
      'true',
    );
    expect(wrapper.find('input[placeholder="/"]').exists()).toBe(false);

    await switchFor(wrapper, 'Require encrypted assertions').trigger('click');
    await switchFor(wrapper, 'Accept IdP-initiated sign-in').trigger('click');
    const landing = wrapper.get('input[placeholder="/"]');
    await landing.setValue('/spaces');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.sso.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: provider.id,
        saml: expect.objectContaining({
          signRequests: true,
          encryptAssertions: true,
          idpInitiated: true,
          landingPath: '/spaces',
        }),
      }),
    );
    wrapper.unmount();
  });

  it('shows the SP certificate and the metadata URL, and regenerates the keys', async () => {
    const wrapper = mountDialog();
    expect(wrapper.get('[data-testid="sp-certificate"]').text()).toContain('OLD CERT');
    expect(wrapper.text()).toContain(
      'https://api.test/api/auth/sso/saml2/sp/metadata?providerId=corp',
    );
    expect(wrapper.find('[aria-label="Copy SP certificate"]').exists()).toBe(true);

    const button = wrapper.findAll('button').find((entry) => entry.text() === 'Regenerate SP keys');
    await button?.trigger('click');
    await flushPromises();
    expect(api.sso.regenerateKeys).toHaveBeenCalledWith({ id: provider.id });
    expect(wrapper.get('[data-testid="sp-certificate"]').text()).toContain('NEW CERT');
    wrapper.unmount();
  });
});
