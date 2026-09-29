<script setup lang="ts">
import { useMediaQuery, useSupported } from '@vueuse/core';
import { computed } from 'vue';
import { PACKET, PACKET_RADIUS, sceneBlocks, sceneLinks, sceneViewBox } from './auth-scene';

/** Decorative isometric block graph behind the auth pages; geometry lives in `auth-scene.ts`. */

// Handled in script: the still scene is a different drawing (no trails or rings, packets parked mid-wire).
const still = useMediaQuery('(prefers-reduced-motion: reduce)');

// Without `offset-path` the packets would stack at the origin, so fall back to the still scene.
const canTravel = useSupported(() => CSS.supports('offset-path', 'path("M 0 0 L 1 1")'));
const moving = computed(() => !still.value && canTravel.value);

/** `structure` (blocks and wires) renders under the page's scrim, `flow` (packets) over it. */
withDefaults(defineProps<{ layer?: 'structure' | 'flow' }>(), { layer: 'structure' });

const blocks = computed(() => sceneBlocks());
const links = computed(() => sceneLinks());
const viewBox = computed(() => sceneViewBox());
</script>

<template>
  <svg
    class="mb-scene h-full w-full"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <!-- Packet halo; a gradient because a blur filter would repaint every frame. -->
      <radialGradient id="mb-scene-glow">
        <stop offset="0%" stop-color="var(--color-iris-300)" stop-opacity="0.85" />
        <stop offset="45%" stop-color="var(--color-iris-500)" stop-opacity="0.45" />
        <stop offset="100%" stop-color="var(--color-iris-500)" stop-opacity="0" />
      </radialGradient>
    </defs>

    <g class="mb-scene-drift">
      <template v-if="layer === 'structure'">
        <g stroke="#fff" stroke-opacity="0.34" stroke-width="0.018" fill="none">
          <path v-for="(link, i) in links" :key="`w${i}`" :d="link.d" />
        </g>

        <g v-for="(block, i) in blocks" :key="`b${i}`" stroke="#fff" stroke-width="0.016">
          <polygon :points="block.left" fill="#fff" fill-opacity="0.08" stroke-opacity="0.3" />
          <polygon :points="block.right" fill="#fff" fill-opacity="0.14" stroke-opacity="0.3" />
          <polygon :points="block.top" fill="#fff" fill-opacity="0.24" stroke-opacity="0.55" />
        </g>
      </template>

      <template v-else>
        <!-- Trails: dashed copies of each wire, drawn before the packets so they sit underneath. -->
        <g v-if="moving" fill="none" stroke="var(--color-iris-300)" stroke-linecap="round">
          <template v-for="(link, i) in links" :key="`t${i}`">
            <path
              v-for="(band, j) in link.trail"
              :key="`t${i}-${j}`"
              class="mb-flow-trail"
              :d="link.d"
              :stroke-width="band.width"
              :stroke-opacity="band.opacity"
              :stroke-dasharray="band.dash"
              :style="{
                '--mb-dash-from': band.from,
                '--mb-dash-to': band.to,
                animationDelay: link.delay,
              }"
            />
          </template>
        </g>

        <!-- Landing rings, on the same cycle as the packets. -->
        <g v-if="moving" fill="none" stroke="var(--color-iris-300)" stroke-width="0.02">
          <g
            v-for="(link, i) in links"
            :key="`r${i}`"
            :transform="`translate(${link.end[0]} ${link.end[1]})`"
          >
            <circle class="mb-flow-ring" r="0.25" :style="{ animationDelay: link.delay }" />
          </g>
        </g>

        <!-- Packets: the outer group travels the wire, the inner one scales in and out. -->
        <g class="mb-scene-packets">
          <g
            v-for="(link, i) in links"
            :key="`p${i}`"
            :class="moving ? 'mb-flow-packet' : undefined"
            :style="
              moving
                ? { offsetPath: `path('${link.d}')`, animationDelay: link.delay }
                : { transform: `translate(${link.mid[0]}px, ${link.mid[1]}px)` }
            "
          >
            <g
              :class="moving ? 'mb-flow-packet-body' : undefined"
              :style="moving ? { animationDelay: link.delay } : undefined"
            >
              <circle :r="PACKET_RADIUS" fill="url(#mb-scene-glow)" />
              <polygon :points="PACKET.left" fill="var(--color-iris-500)" />
              <polygon :points="PACKET.right" fill="var(--color-iris-400)" />
              <polygon
                :points="PACKET.top"
                fill="var(--color-iris-200)"
                stroke="#fff"
                stroke-opacity="0.4"
                stroke-width="0.009"
              />
            </g>
          </g>
        </g>
      </template>
    </g>
  </svg>
</template>

<style scoped>
/* One period for every animation; must match `CYCLE` in the script. */
.mb-scene {
  --mb-cycle: 5.2s;
  /* Shared by packet and trail so the light stays under the packet. */
  --mb-travel: cubic-bezier(0.45, 0, 0.55, 1);
}

/* Slow lift and settle, small enough not to cross the copy. */
@keyframes mb-scene-drift {
  0%,
  100% {
    transform: translateY(-0.06px);
  }
  50% {
    transform: translateY(0.06px);
  }
}

.mb-scene-drift {
  animation: mb-scene-drift 11s ease-in-out infinite;
  will-change: transform;
}

@keyframes mb-flow-packet {
  from {
    offset-distance: 0%;
  }
  to {
    offset-distance: 100%;
  }
}

.mb-flow-packet {
  /* `fill-box`: otherwise `center` is the SVG viewBox's, not the packet's. */
  transform-box: fill-box;
  transform-origin: center;
  offset-anchor: center;
  offset-rotate: 0deg;
  animation: mb-flow-packet var(--mb-cycle) var(--mb-travel) infinite;
}

/* Grow and shrink envelope; linear so its percentages track the run. */
@keyframes mb-flow-packet-body {
  /* 0.01, not 0: an empty bounding box would shift the anchor. */
  0% {
    transform: scale(0.01);
    opacity: 0;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  /* Faint until clear of the junction. */
  8% {
    opacity: 0.16;
  }
  18% {
    transform: scale(1);
    opacity: 1;
  }
  85% {
    transform: scale(1);
    opacity: 1;
    animation-timing-function: cubic-bezier(0.4, 0, 1, 1);
  }
  100% {
    transform: scale(0.01);
    opacity: 0;
  }
}

.mb-flow-packet-body {
  transform-box: fill-box;
  transform-origin: center;
  animation: mb-flow-packet-body var(--mb-cycle) linear infinite;
}

/* Swept by the path length so the trail stays just behind the packet. */
@keyframes mb-flow-trail {
  from {
    stroke-dashoffset: var(--mb-dash-from);
  }
  to {
    stroke-dashoffset: var(--mb-dash-to);
  }
}

/*
 * Fades in after the packet has grown and out before it shrinks, so the light never runs
 * ahead of the packet or shows at a junction.
 */
@keyframes mb-flow-trail-fade {
  0% {
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  88%,
  100% {
    opacity: 0;
  }
}

.mb-flow-trail {
  /* One delay drives both, so sweep and fade stay in sync. */
  animation:
    mb-flow-trail var(--mb-cycle) var(--mb-travel) infinite,
    mb-flow-trail-fade var(--mb-cycle) linear infinite;
}

/* Opens as the packet lands. */
@keyframes mb-flow-ring {
  0%,
  84% {
    transform: scale(0.16);
    opacity: 0;
  }
  88% {
    opacity: 0.85;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

.mb-flow-ring {
  transform-box: fill-box;
  transform-origin: center;
  animation: mb-flow-ring var(--mb-cycle) ease-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .mb-scene-drift,
  .mb-flow-trail,
  .mb-flow-packet,
  .mb-flow-packet-body,
  .mb-flow-ring {
    animation: none;
  }
}
</style>
