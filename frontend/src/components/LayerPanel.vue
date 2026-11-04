<script setup>
// Left panel: layer, legend, places (boards Flow 1, Flow 3, 2e). Inactive until an area is loaded:
// the panel stays visible, only the controls fade (brief §3 Map flow). Thermal turns on once thermal
// comfort is ready; Senses and Overall wait for the rating.
import { computed } from 'vue'
import { thermalLegend } from '../lib/thermal.js'
import { useAreaStore } from '../stores/area.js'

const area = useAreaStore()
const LAYERS = [{ id: 'senses', label: 'Senses' }, { id: 'thermal', label: 'Thermal' }, { id: 'overall', label: 'Overall' }]
const LEGEND = [
  { label: 'Easy', color: 'var(--easy)' },
  { label: 'Mixed', color: 'var(--mixed)' },
  { label: 'Hard', color: 'var(--hard)' },
  { label: 'No photo', color: 'var(--no-photo)' },
]
const THERMAL_LEGEND = thermalLegend().map((l) => ({ label: l.label, color: `var(--${l.state})` }))
const PLACES = ['All', 'Parks', 'Squares', 'Markets', 'Busy roads', 'Residential']

const ready = (id) => id === 'thermal' && area.thermal === 'ready'
const anyReady = computed(() => LAYERS.some((l) => ready(l.id)))
const showThermal = computed(() => area.layer === 'thermal')
const info = computed(() => area.thermalInfo)
const note = computed(() => {
  if (area.step !== 'analysed') return 'Layers appear once you load an area.'
  if (area.thermal === 'error') return area.thermalError
  if (area.thermal === 'ready') return 'Thermal comfort is ready. Senses and Overall follow when your photos are rated.'
  return 'Layers are ready once this area has loaded.'
})
</script>

<template>
  <aside class="panel left" data-panel="layers" data-scrollable aria-label="Layers and places">
    <section>
      <h2 class="section-title">Layer</h2>
      <div class="layers" :class="{ inactive: !anyReady }">
        <button v-for="l in LAYERS" :key="l.id" type="button" class="seg" :class="{ on: area.layer === l.id }"
                :disabled="!ready(l.id)" :aria-pressed="area.layer === l.id" @click="area.layer = l.id">
          {{ l.label }}
        </button>
      </div>
      <template v-if="showThermal">
        <p class="legend-title">Feels like temperature, hot or cold</p>
        <ul class="legend">
          <li v-for="s in THERMAL_LEGEND" :key="s.label"><span class="swatch" :style="{ background: s.color }" />{{ s.label }}</li>
        </ul>
        <p class="note">
          Simulated by Infrared.city for {{ info.season }}, {{ info.time }}<template v-if="info.station?.name">,
          with weather from {{ info.station.name }}</template>. Standard limits, not personalised yet.
          A prediction, not a reason.
        </p>
      </template>
      <template v-else>
        <ul class="legend inactive">
          <li v-for="s in LEGEND" :key="s.label"><span class="swatch" :style="{ background: s.color }" />{{ s.label }}</li>
        </ul>
        <p class="note">{{ note }}</p>
      </template>
    </section>
    <section class="places">
      <h2 class="section-title">Places</h2>
      <div class="chips inactive">
        <button v-for="p in PLACES" :key="p" type="button" class="chip" :class="{ on: p === 'All' }" disabled>{{ p }}</button>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
section + section { border-top: var(--hairline) solid var(--line); margin-top: var(--space-4); padding-top: var(--space-4); }
.layers { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-3); }
.seg {
  min-height: var(--touch); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; font-size: var(--fs-md);
}
.seg.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.layers:not(.inactive) .seg:disabled { opacity: var(--inactive-opacity); }
.legend-title { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.legend-title + .legend { margin-top: var(--space-2); }
.legend {
  list-style: none; padding: 0; margin: var(--space-4) 0 0;
  display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4);
}
.legend li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); }
.note { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.chip {
  min-height: var(--chip-h); padding: 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill);
  background: transparent; font-size: var(--fs-sm);
}
.chip.on { background: var(--btn-selected-bg); }
</style>
