<script setup>
// The numbered marker badge (suggestions now, chat results later): a solid circle in the level colour
// with a dark edge and a dark bold number. The same badge is the map pin and the list row's number.
defineProps({
  n: { type: [Number, String], required: true },
  /** 'easy' | 'mixed' | 'hard' */
  level: { type: String, default: 'easy' },
  /** A colour of its own instead of the level's (a Senses prediction on its 1–5 scale). */
  color: { type: String, default: null },
})
</script>

<template>
  <span class="marker-pin" :style="{ background: color ?? `var(--${level})` }" aria-hidden="true">{{ n }}</span>
</template>

<style scoped>
.marker-pin {
  display: inline-grid; place-items: center; flex: none;
  width: var(--marker-size); height: var(--marker-size);
  border: var(--marker-border) solid var(--marker-edge); border-radius: 50%;
  color: var(--marker-text); font-size: var(--fs-sm); font-weight: var(--fw-bold); line-height: 1;
  font-variant-numeric: tabular-nums;
}
</style>
