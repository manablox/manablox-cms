<script setup lang="ts">
/** Magic around an AI button while the model works; the button is the `relative` box. */
defineProps<{ active: boolean }>();

/** A four-point star with concave sides, drawn in a 24 box. */
const STAR =
  'M12 0c.7 6 5.3 10.6 11.3 11.3l.7.7-.7.7C17.3 13.4 12.7 18 12 24c-.7-6-5.3-10.6-11.3-11.3L0 12l.7-.7C6.7 10.6 11.3 6 12 0Z';

/**
 * Each star's point on the edge, the drift away from it, its size, tone and timing.
 * Sizes and speeds vary so the ring never reads as a mechanical loop.
 */
const STARS = [
  { left: '2%', top: '0%', x: '-0.35rem', y: '-0.4rem', size: '0.85rem', dur: '1.9s', delay: '0s' },
  {
    left: '26%',
    top: '-6%',
    x: '-0.1rem',
    y: '-0.5rem',
    size: '0.5rem',
    dur: '2.3s',
    delay: '0.9s',
    tone: 'iris',
  },
  {
    left: '52%',
    top: '-4%',
    x: '0.05rem',
    y: '-0.55rem',
    size: '0.65rem',
    dur: '1.6s',
    delay: '0.45s',
    tone: 'gold',
  },
  {
    left: '80%',
    top: '-2%',
    x: '0.2rem',
    y: '-0.45rem',
    size: '0.55rem',
    dur: '2.1s',
    delay: '1.35s',
  },
  {
    left: '100%',
    top: '6%',
    x: '0.4rem',
    y: '-0.3rem',
    size: '0.95rem',
    dur: '1.8s',
    delay: '0.2s',
    tone: 'iris',
  },
  {
    left: '104%',
    top: '62%',
    x: '0.45rem',
    y: '0.15rem',
    size: '0.6rem',
    dur: '2.2s',
    delay: '1.1s',
  },
  {
    left: '86%',
    top: '102%',
    x: '0.2rem',
    y: '0.45rem',
    size: '0.7rem',
    dur: '1.7s',
    delay: '0.65s',
    tone: 'gold',
  },
  {
    left: '54%',
    top: '104%',
    x: '0rem',
    y: '0.5rem',
    size: '0.5rem',
    dur: '2.4s',
    delay: '1.5s',
    tone: 'iris',
  },
  {
    left: '22%',
    top: '100%',
    x: '-0.25rem',
    y: '0.4rem',
    size: '0.8rem',
    dur: '1.9s',
    delay: '0.3s',
  },
  {
    left: '-4%',
    top: '54%',
    x: '-0.45rem',
    y: '0.1rem',
    size: '0.6rem',
    dur: '2s',
    delay: '0.8s',
    tone: 'gold',
  },
];

/** Dust rising off the button, behind the stars. */
const MOTES = [
  { left: '14%', dur: '2.6s', delay: '0.2s' },
  { left: '38%', dur: '3.1s', delay: '1.1s' },
  { left: '62%', dur: '2.4s', delay: '0.7s' },
  { left: '88%', dur: '2.9s', delay: '1.6s' },
];
</script>

<template>
  <span v-if="active" class="ai-magic" aria-hidden="true">
    <span class="ai-magic-aura" />
    <!-- The travelling light: a conic sweep with only the edge band left showing. -->
    <span class="ai-magic-ring"><span class="ai-magic-beam" /></span>
    <span
      v-for="mote in MOTES"
      :key="mote.left"
      class="ai-magic-mote"
      :style="{ left: mote.left, animationDuration: mote.dur, animationDelay: mote.delay }"
    />
    <svg
      v-for="star in STARS"
      :key="star.left + star.top"
      class="ai-magic-star"
      :class="star.tone === 'iris' ? 'ai-magic-iris' : star.tone === 'gold' ? 'ai-magic-gold' : ''"
      viewBox="0 0 24 24"
      :style="{
        left: star.left,
        top: star.top,
        fontSize: star.size,
        animationDuration: star.dur,
        animationDelay: star.delay,
        '--magic-x': star.x,
        '--magic-y': star.y,
      }"
    >
      <path :d="STAR" fill="currentColor" />
    </svg>
  </span>
</template>
