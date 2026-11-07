<script setup>
// Left panel (boards Flow 1, Flow 3, 2e), controls first and the legend last: Layer → Season and time
// (for Thermal and Overall, and before analysis, where Analyse uses the choice) → Places → Legend.
// Inactive until an area is loaded: the panel stays visible, only the controls fade (brief §3 Map flow).
import { computed } from 'vue'
import { PLACE_FILTERS } from '../lib/place.js'
import { useAreaStore } from '../stores/area.js'
import LayerButtons from './LayerButtons.vue'
import SeasonTime from './SeasonTime.vue'
import ThermalLegend from './ThermalLegend.vue'

const area = useAreaStore()
const LEGEND = [
  { label: 'Easy', color: 'var(--easy)' },
  { label: 'Mixed', color: 'var(--mixed)' },
  { label: 'Hard', color: 'var(--hard)' },
  { label: 'No photo', color: 'var(--no-photo)' },
]
/** Feels-like values of the whole loaded area, for the season and time shown (the legend's side). */
const thermalValues = computed(() => (area.segments?.features ?? []).map((f) => f.properties.utci).filter((v) => v != null))

/** Season and time matter for Thermal and Overall, not for Senses (photo ratings). */
const showWindow = computed(() => area.layer !== 'senses')
const showThermal = computed(() => area.layer === 'thermal')
const info = computed(() => area.thermalInfo)
/** The Places chips filter the map and the suggestions once the area's streets are loaded. */
const placesReady = computed(() => area.step === 'analysed' && area.load === 'ready')
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
      <LayerButtons />
      <SeasonTime v-if="showWindow" :store="area" />
      <h2 class="section-title places-title">Places</h2>
      <div class="chips" :class="{ inactive: !placesReady }" role="group" aria-label="Show places">
        <button v-for="p in PLACE_FILTERS" :key="p.id" type="button" class="chip" :class="{ on: area.placeFilter === p.id }"
                :disabled="!placesReady" :aria-pressed="area.placeFilter === p.id" @click="area.setPlaceFilter(p.id)">
          {{ p.label }}
        </button>
      </div>
    </section>
    <section class="legend-section" aria-label="Legend">
      <template v-if="showThermal">
        <ThermalLegend :values="thermalValues" />
        <p class="note">
          Simulated by Infrared.city for {{ info.season }}, {{ info.time }}<template v-if="info.station?.name">,
          with weather from {{ info.station.name }}</template>. A prediction, not a reason.
        </p>
      </template>
      <template v-else>
        <ul class="legend inactive">
          <li v-for="s in LEGEND" :key="s.label"><span class="swatch" :style="{ background: s.color }" />{{ s.label }}</li>
        </ul>
        <p class="note">{{ note }}</p>
      </template>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
section + section { border-top: var(--hairline) solid var(--line); margin-top: var(--space-4); padding-top: var(--space-1); }
.places-title { margin-top: var(--space-4); }
.legend {
  list-style: none; padding: 0; margin: var(--space-3) 0 0;
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
