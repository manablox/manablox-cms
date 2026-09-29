import HostVerification, {
  type HostVerificationState,
} from '@manablox/admin-sdk/components/HostVerification.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const pending: HostVerificationState = {
  status: 'pending',
  required: true,
  txtName: '_manablox.shop.example',
  txtValue: 'manablox-verify-abc',
  cnameTarget: null,
};

const render = (verification: HostVerificationState, canManage = true) =>
  mount(HostVerification, { props: { hostname: 'shop.example', verification, canManage } });

describe('HostVerification', () => {
  it('shows nothing for a verified host', () => {
    expect(render({ ...pending, status: 'verified', txtValue: null }).text()).toBe('');
  });

  it('shows the TXT record and a check for a pending host', async () => {
    const wrapper = render(pending);
    expect(wrapper.text()).toContain('Not served until it is verified');
    expect(wrapper.text()).toContain('_manablox.shop.example');
    expect(wrapper.text()).toContain('manablox-verify-abc');
    expect(wrapper.text()).not.toContain('CNAME');
    await wrapper.get('[aria-label="Verify shop.example now"]').trigger('click');
    expect(wrapper.emitted('verify')).toHaveLength(1);
  });

  it('offers the CNAME target when one is configured, and explains a failure', () => {
    const wrapper = render({ ...pending, status: 'failed', cnameTarget: 'edge.example.net' });
    expect(wrapper.text()).toContain('automatic checks stopped');
    expect(wrapper.text()).toContain('edge.example.net');
  });

  it('says an unverified host is served while verification is not required', () => {
    const wrapper = render({ ...pending, required: false }, false);
    expect(wrapper.text()).toContain('served anyway');
    expect(wrapper.find('[aria-label="Verify shop.example now"]').exists()).toBe(false);
  });
});
