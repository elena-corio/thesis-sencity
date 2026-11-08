<script setup>
// The last block of the left panel, once the layer's data is loaded: the legend of the chosen layer, with
// its title.
import ThermalLegend from './ThermalLegend.vue'

defineProps({
  layer: { type: String, required: true },
  /** Feels-like values on screen, for the thermal legend. */
  values: { type: Array, default: () => [] },
  /** Extra rows after Hard on the thermal legend, e.g. "No value" on the routes. */
  extra: { type: Array, default: () => [] },
})
const TITLES = { senses: 'Sensory comfort', overall: 'Overall comfort' }
const ROWS = [
  { label: 'Easy', color: 'var(--easy)' }, { label: 'Mixed', color: 'var(--mixed)' },
  { label: 'Hard', color: 'var(--hard)' }, { label: 'No photo', color: 'var(--no-photo)' },
]
</script>

<template>
  <ThermalLegend v-if="layer === 'thermal'" :values="values" :extra="extra" />
  <div v-else>
    <h2 class="title">{{ TITLES[layer] }}</h2>
    <ul class="rows">
      <li v-for="r in ROWS" :key="r.label"><span class="swatch" :style="{ background: r.color }" />{{ r.label }}</li>
    </ul>
  </div>
</template>

<style scoped>
.title { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.rows { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: var(--space-2) 0 0; padding: 0; }
.rows li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { flex: none; width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); }
</style>
