import {
  FEATURE_ON,
  featureLabel,
  featureState,
  registerPluginFeatures,
} from '@manablox/admin-sdk/lib/features';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { meWithControls } from '../controls-fixture';

describe('featureState', () => {
  it('is on without a session or a listed switch', () => {
    expect(featureState(null, 'databags', 's1')).toEqual(FEATURE_ON);
    expect(featureState(meWithControls(), 'approvals', 's1')).toEqual(FEATURE_ON);
  });

  it('reads the space, falling back to the instance for an unlisted space', () => {
    const me = meWithControls();
    expect(featureState(me, 'menus', 's1')).toMatchObject({
      enabled: false,
      hidden: true,
      locked: false,
    });
    expect(featureState(me, 'menus', 'other').enabled).toBe(true);
    expect(featureState(me, 'databags', 'other')).toMatchObject({
      locked: true,
      message: 'Upgrade for databags',
    });
    expect(featureState(me, 'databags', null).locked).toBe(true);
  });

  it("takes the feature's link, else the upgrade link", () => {
    const me = meWithControls();
    expect(featureState(me, 'tags', 's1').link).toBe('https://example.com/tags');
    expect(featureState(me, 'databags', 's1').link).toBe('https://example.com/upgrade');
  });

  it('names built-in and plugin features', () => {
    expect(featureLabel('customDomains')).toBe('Custom domains');
    expect(featureLabel('plugins.acme.seo')).toBe('The acme.seo plugin');
  });

  it('names registered plugin flags and features by their labels', () => {
    registerPluginFeatures([
      {
        name: 'hello',
        feature: 'plugins.hello',
        controls: [
          { key: 'features.plugins.hello.shout', kind: 'feature', label: 'Shouted greetings' },
          { key: 'limits.plugins.hello.greetings', kind: 'limit', label: 'Greetings' },
        ],
      },
    ]);
    expect(featureLabel('plugins.hello')).toBe('The hello plugin');
    expect(featureLabel('plugins.hello.shout')).toBe('Shouted greetings');
  });
});

describe('session.feature', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('answers from the signed-in account', () => {
    const session = useSessionStore();
    expect(session.feature('databags', 's1').enabled).toBe(true);
    session.me = meWithControls();
    expect(session.feature('databags', 's1')).toMatchObject({ enabled: false, locked: true });
    expect(session.feature('menus', 's1').hidden).toBe(true);
  });
});
