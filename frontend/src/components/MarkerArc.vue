<script setup>
// The direction of a photo, on a marker (boards Flow 4, 4b, P2, Routes 5): a 90 degree arc around the point, centred on
// the photo's camera direction, and a copy that grows out from the point, perpendicular to the arc, and fades
// (Elena, 2026-11-11; the old ring's timing: 2.4 s, ease-out). Drawn
// at `radius` from the centre; the parent places it on the point. No direction: nothing (the caller leaves it out).
// With reduced motion the copy is not drawn (style.css stops every animation too).
defineProps({
  /** Compass degrees on screen: the photo's direction minus the map's bearing. */
  angle: { type: Number, required: true },
  /** The arc's radius, a CSS length (the old ring's, or the pin's edge). */
  radius: { type: String, required: true },
  pulse: Boolean,
  /** 'ring' (the selected point: white with a glow in dark mode, dark teal in light) or 'pin' (white, on a suggestion).
   *  The classes are arc-ring and arc-pin: a parent's scoped .ring or .pin style would reach this root element too. */
  kind: { type: String, default: 'ring' },
})
// In a 100 x 100 box around the centre: radius 40, from 45 degrees left of up to 45 right.
const ARC = 'M -28.284 -28.284 A 40 40 0 0 1 28.284 -28.284'
</script>

<template>
  <svg class="marker-arc" :class="`arc-${kind}`" viewBox="-50 -50 100 100" aria-hidden="true"
       :style="{ width: `calc(${radius} * 2.5)`, height: `calc(${radius} * 2.5)`, transform: `translate(-50%, -50%) rotate(${angle}deg)` }">
    <path :d="ARC" class="line" />
    <path v-if="pulse" :d="ARC" class="line pulse" />
  </svg>
</template>

<style scoped>
.marker-arc { position: absolute; left: 50%; top: 50%; overflow: visible; pointer-events: none; }
.line { fill: none; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.arc-ring .line { stroke: var(--ring); stroke-width: var(--arc-width); filter: drop-shadow(var(--arc-glow)); }
.arc-pin .line { stroke: var(--arc-on-pin); stroke-width: var(--arc-pin-width); }
/* The copy grows from the centre of the arc's circle, the point itself (0, 0 in this box): it gets bigger and moves
   straight out, perpendicular to the arc's middle, like a ripple, and never drifts sideways. With transform-box view-box
   the origin is the box's (0, 0), not its corner, so the origin is given in units, not percentages. */
.pulse {
  transform-box: view-box; transform-origin: 0px 0px;
  animation: arc-pulse var(--ring-pulse-s) ease-out infinite;
}
@keyframes arc-pulse {
  from { transform: scale(1); opacity: 0.6; }
  to { transform: scale(1.6); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .pulse { display: none; } }
</style>
