<script setup>
// One of the eight sense icons (assets/icons, drawn in currentColor). The SVG text comes from our own files,
// chosen from a fixed list, never from the model.
import { computed } from 'vue'

const files = import.meta.glob('../assets/icons/*.svg', { eager: true, query: '?raw', import: 'default' })
const FILE = {
  sight: 'sight', hearing: 'hearing', smell: 'smell', touch: 'touch', thermal: 'thermal',
  balance_movement: 'vestibular', body_awareness: 'body-awareness', inner_sensations: 'inner-sensations',
}
const props = defineProps({
  sense: { type: String, default: null },
  /** The name of the sense, for the tooltip and screen readers. */
  label: { type: String, default: '' },
})
const svg = computed(() => files[`../assets/icons/${FILE[props.sense]}.svg`] ?? null)
</script>

<template>
  <span v-if="svg" class="sense-icon" role="img" :aria-label="label" :title="label" v-html="svg" />
</template>

<style scoped>
.sense-icon { display: inline-grid; flex: none; width: var(--icon); height: var(--icon); }
.sense-icon :deep(svg) { width: 100%; height: 100%; }
</style>
