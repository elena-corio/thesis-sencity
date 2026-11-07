<script setup>
// Left panel (boards Flow 1, Flow 3, 2e), controls first and the legend last: the area inputs (one row,
// opened to type) → Layer → Season and time (for Thermal and Overall, and before analysis, where Analyse
// uses the choice) → Places → Legend (only once the area's thermal comfort is loaded).
// Inactive until an area is loaded: the panel stays visible, only the controls fade (brief §3 Map flow).
import { computed, ref } from 'vue'
import { PLACE_FILTERS } from '../lib/place.js'
import { useAreaStore } from '../stores/area.js'
import AreaInputs from './AreaInputs.vue'
import LayerButtons from './LayerButtons.vue'
import SeasonTime from './SeasonTime.vue'
import ThermalLegend from './ThermalLegend.vue'

defineProps({ getCentre: { type: Function, default: () => null } })
const emit = defineEmits(['pick'])
const area = useAreaStore()
const menuOpen = ref(false)
/** Feels-like values of the whole loaded area, for the season and time shown (the legend's side). */
const thermalValues = computed(() => (area.segments?.features ?? []).map((f) => f.properties.utci).filter((v) => v != null))

/** Season and time matter for Thermal and Overall, not for Senses (photo ratings). */
const showWindow = computed(() => area.layer !== 'senses')
const showThermal = computed(() => area.layer === 'thermal')
/** The Places chips filter the map and the suggestions once the area's streets are loaded. */
const placesReady = computed(() => area.step === 'analysed' && area.load === 'ready')
</script>

<template>
  <aside class="panel left" :class="{ 'menu-open': menuOpen }" data-panel="layers" data-scrollable aria-label="Area, layers and places">
    <AreaInputs class="area-inputs" :get-centre="getCentre" @pan="emit('pick', $event)" @menu="menuOpen = $event" />
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
    <!-- The legend only once the thermal comfort of the area is loaded (the source is in its tooltip). -->
    <section v-if="showThermal" class="legend-section" aria-label="Legend">
      <ThermalLegend :values="thermalValues" />
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
/* The suggestions float over the map, not inside the panel. */
.left.menu-open { overflow: visible; }
/* The inputs are a section too: the line between sections divides them from the layer. */
section + section { border-top: var(--hairline) solid var(--line); margin-top: var(--space-4); padding-top: var(--space-4); }
/* The inputs row and the first controls: a little less room above the Layer title. */
.area-inputs + section { padding-top: var(--space-1); }
.places-title { margin-top: var(--space-4); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.chip {
  min-height: var(--chip-h); padding: 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill);
  background: transparent; font-size: var(--fs-sm);
}
.chip.on { background: var(--btn-selected-bg); }
</style>
