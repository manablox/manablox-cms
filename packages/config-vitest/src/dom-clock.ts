/**
 * Setup file of every suite: in a DOM, `Date.now` follows the monotonic clock.
 *
 * `@vue/test-utils` stamps each `trigger()` with `Date.now() + 1`, and Vue drops an event
 * stamped no later than its handler was attached. A wall clock that steps back, as a VM's
 * time sync does, therefore swallows events without an error, in whichever test is running.
 *
 * Node suites keep the real clock, which they compare with the database's.
 */
if ('document' in globalThis) {
  // Bound now, so fake timers that replace `performance.now` leave this clock running.
  const monotonic = performance.now.bind(performance);
  const offset = Date.now() - monotonic();
  Date.now = () => Math.floor(offset + monotonic());
}
