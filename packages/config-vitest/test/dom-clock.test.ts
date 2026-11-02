import { afterEach, describe, expect, it, vi } from 'vitest';

const realNow = Date.now;

/** Loads the setup file afresh, in a DOM or without one. */
async function install(dom: boolean) {
  if (dom) vi.stubGlobal('document', {});
  vi.resetModules();
  await import('../src/dom-clock.js');
}

afterEach(() => {
  Date.now = realNow;
});

describe('dom-clock', () => {
  it('starts at the wall clock and ignores it from then on', async () => {
    let wall = 1_000_000;
    Date.now = () => wall;
    await install(true);
    const start = Date.now();
    expect(Math.abs(start - 1_000_000)).toBeLessThan(5);

    wall -= 6_150;
    expect(Date.now()).toBeGreaterThanOrEqual(start);
  });

  it('keeps running under fake timers that replace performance.now', async () => {
    await install(true);
    const start = Date.now();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(start));
    vi.restoreAllMocks();
  });

  it('leaves the real clock to suites without a DOM', async () => {
    const wall = () => 1_000_000;
    Date.now = wall;
    await install(false);
    expect(Date.now).toBe(wall);
  });
});
