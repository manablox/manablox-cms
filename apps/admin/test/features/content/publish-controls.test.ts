import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));

import type { ScheduleWindow } from '@manablox/admin-sdk/lib/schedule';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import PublishControls from '~/features/content/components/PublishControls.vue';
import { meWithControls } from '../../controls-fixture';

function lockScheduling(presentation: 'locked' | 'hidden') {
  const me = meWithControls();
  const space = me.controls?.spaces.s1;
  if (space) space.features.scheduledPublishing = { presentation };
  useSessionStore().me = me;
}

const render = (schedule: ScheduleWindow) =>
  mount(PublishControls, {
    props: {
      isPublished: true,
      canPublishNow: true,
      scheduled: false,
      schedule,
      savingSchedule: false,
      saved: true,
      showSchedule: false,
    },
    global: { stubs: { Icon: true, Popover: true, FeatureLock: true, ScheduleFields: true } },
  });

const clearButton = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll('button').find((button) => button.text().includes('Clear schedule'));

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('PublishControls with scheduling off', () => {
  it('still clears a saved schedule', async () => {
    lockScheduling('locked');
    const wrapper = render({ publishAt: '2030-01-01T10:00:00.000Z', unpublishAt: null });
    const button = clearButton(wrapper);
    expect(button).toBeDefined();
    await button?.trigger('click');
    expect(wrapper.emitted('saveSchedule')).toEqual([[{ publishAt: null, unpublishAt: null }]]);
  });

  it('offers clearing when the feature is hidden too', () => {
    lockScheduling('hidden');
    expect(
      clearButton(render({ publishAt: null, unpublishAt: '2030-01-01T10:00:00.000Z' })),
    ).toBeDefined();
  });

  it('shows nothing to clear without dates or while scheduling is on', () => {
    lockScheduling('locked');
    expect(clearButton(render({ publishAt: null, unpublishAt: null }))).toBeUndefined();
    useSessionStore().me = meWithControls();
    expect(
      clearButton(render({ publishAt: '2030-01-01T10:00:00.000Z', unpublishAt: null })),
    ).toBeUndefined();
  });
});
