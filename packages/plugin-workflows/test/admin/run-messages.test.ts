import { registerPluginMessages } from '@manablox/admin-sdk/lib/messages';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMessage } from '../../src/admin/model/runs';
import { workflowErrors } from '../../src/server/errors';

// The admin registers these from `/admin/plugins.json` when it boots.
beforeAll(() =>
  registerPluginMessages([
    {
      errors: Object.fromEntries(
        Object.entries(workflowErrors).map(([key, spec]) => [key, spec.message]),
      ),
      nouns: {},
    },
  ]),
);

describe('runMessage', () => {
  it('words a known key with its params', () => {
    expect(
      runMessage('https://x.test answered HTTP 502', 'plugins.workflows.run.pageStatus', {
        url: 'https://x.test',
        status: 502,
      }),
    ).toBe('https://x.test answered with HTTP 502.');
  });

  it('keeps the stored message for an unknown key', () => {
    expect(runMessage('Something odd', 'plugins.workflows.run.fromTheFuture', {})).toBe(
      'Something odd',
    );
    expect(runMessage('Plain English message')).toBe('Plain English message');
    expect(runMessage('plugins.workflows.run.timeout')).toBe(
      'The run took too long and was stopped.',
    );
    expect(runMessage(null)).toBe('');
  });
});
