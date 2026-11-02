import { describe, expect, it, vi } from 'vitest';
import { useDesignRun } from '../../src/admin/useDesignRun';

describe('useDesignRun', () => {
  it('runs with the trimmed prompt and the picked provider, keeping the answer', async () => {
    const design = vi.fn(async (input: { prompt: string; providerKind?: string }) => input.prompt);
    const run = useDesignRun(design);
    expect(run.ready.value).toBe(false);
    await run.run();
    expect(design).not.toHaveBeenCalled();

    run.prompt.value = '  a bakery  ';
    run.provider.value = 'openai';
    await run.run();
    expect(design).toHaveBeenCalledWith({ prompt: 'a bakery', providerKind: 'openai' });
    expect(run.result.value).toBe('a bakery');
    expect(run.busy.value).toBe(false);
  });

  it('keeps a failure as its note and takes its own readiness', async () => {
    const run = useDesignRun(
      async () => {
        throw new Error('no provider');
      },
      { ready: () => true },
    );
    await run.run();
    expect(run.note.value).toBe('no provider');
    expect(run.result.value).toBeNull();
  });
});
