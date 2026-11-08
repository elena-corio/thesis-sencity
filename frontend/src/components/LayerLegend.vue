<script setup>
// The legend of the chosen layer, with its title, once the layer's data is loaded: the last block of the
// left panel, or (compact) the strip above the phone sheet, which is only the title and the swatches.
import { computed } from 'vue'
import ThermalLegend from './ThermalLegend.vue'

const props = defineProps({
  layer: { type: String, required: true },
  /** Feels-like values on screen, for the thermal legend. */
  values: { type: Array, default: () => [] },
  /** Extra rows after Hard on the thermal legend, e.g. "No value" on the routes. */
  extra: { type: Array, default: () => [] },
  compact: Boolean,
})
const TITLES = { senses: 'Sensory comfort', thermal: 'Thermal comfort °C', overall: 'Overall comfort' }
// Thermal lights every street with a value, photo or not: its grey means no value.
const rows = computed(() => [
  { label: 'Easy', color: 'var(--easy)' }, { label: 'Mixed', color: 'var(--mixed)' }, { label: 'Hard', color: 'var(--hard)' },
  { label: props.layer === 'thermal' ? 'No value' : 'No photo', color: 'var(--no-photo)' },
])
</script>

<template>
  <ThermalLegend v-if="layer === 'thermal' && !compact" :values="values" :extra="extra" />
  <div v-else>
    <h2 class="title">{{ TITLES[layer] }}</h2>
    <ul class="rows" data-testid="legend-rows">
      <li v-for="r in rows" :key="r.label"><span class="swatch" :style="{ background: r.color }" />{{ r.label }}</li>
    </ul>
  </div>
</template>

<style scoped>
.title { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.rows { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: var(--space-1) 0 0; padding: 0; font-size: var(--fs-sm); }
.rows li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { flex: none; width: var(--space-4); height: var(--swatch-h); border-radius: var(--radius-pill); }
</style>
