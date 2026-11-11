<script setup>
// The numbered marker badge (suggestions now, chat results later): a solid circle in the level colour
// with a dark edge and a dark bold number. The same badge is the map pin and the list row's number.
defineProps({
  n: { type: Number, required: true },
  /** The circle's size: the list badge (default) or the map pin (--marker-map-size). */
  size: { type: String, default: 'var(--marker-size)' },
  /** On the map: its own outline and number colours; the list badge keeps the dark ones. The class is on-map: the map's
   *  scoped .map style would reach this root element too. */
  map: Boolean,
  /** 'easy' | 'mixed' | 'hard' */
  level: { type: String, default: 'easy' },
})
</script>

<template>
  <span class="marker-pin" :class="{ 'on-map': map }" :style="{ background: `var(--${level})`, width: size, height: size }" aria-hidden="true">{{ n }}</span>
</template>

<style scoped>
.marker-pin {
  display: inline-grid; place-items: center; flex: none;
  width: var(--marker-size); height: var(--marker-size);
  border: var(--marker-border) solid var(--marker-edge); border-radius: 50%;
  color: var(--marker-text); font-size: var(--fs-sm); font-weight: var(--fw-bold); line-height: 1;
  font-variant-numeric: tabular-nums;
}
.marker-pin.on-map { border-color: var(--marker-map-edge); color: var(--marker-map-text); }
</style>
