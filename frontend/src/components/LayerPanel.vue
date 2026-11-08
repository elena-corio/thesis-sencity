<script setup>
// Left panel (boards Flow 1c, 2, 2e), controls first and the legend last: the area inputs and Analyse →
// Layer → Season and time (for Thermal and Overall) → Places → the legend of the chosen layer. On a phone
// it is the Settings tab of the sheet: no panel of its own, and the legend floats on the map instead.
import { computed, ref } from 'vue'
import { PLACE_FILTERS } from '../lib/place.js'
import { useAreaStore } from '../stores/area.js'
import AreaInputs from './AreaInputs.vue'
import ChoiceButtons from './ChoiceButtons.vue'
import LayerButtons from './LayerButtons.vue'
import LayerLegend from './LayerLegend.vue'
import SeasonTime from './SeasonTime.vue'

defineProps({ phone: Boolean, getCentre: { type: Function, default: () => null } })
const emit = defineEmits(['pick'])
const area = useAreaStore()
const menuOpen = ref(false)
/** Feels-like values of the whole loaded area, for the season and time shown (the legend's side). */
const thermalValues = computed(() => (area.segments?.features ?? []).map((f) => f.properties.utci).filter((v) => v != null))

/** Season and time matter for Thermal and Overall, not for Senses (photo ratings). */
const showWindow = computed(() => area.layer !== 'senses')
/** The Places buttons filter the map and the suggestions once the area's streets are loaded. */
const placesReady = computed(() => area.step === 'analysed' && area.load === 'ready')
</script>

<template>
  <aside :class="phone ? 'embedded' : ['panel', 'left', { 'menu-open': menuOpen }]" :data-panel="phone ? undefined : 'layers'"
         data-scrollable aria-label="Area, layers and places">
    <AreaInputs class="area-inputs" :phone="phone" :get-centre="getCentre" @pan="emit('pick', $event)" @menu="menuOpen = $event" />
    <section>
      <h2 class="section-title">Layer</h2>
      <LayerButtons />
      <SeasonTime v-if="showWindow" :store="area" />
      <h2 class="section-title places-title">Places</h2>
      <ChoiceButtons class="chips" label="Show places" :options="PLACE_FILTERS" :value="area.placeFilter"
                     :disabled="!placesReady" @choose="area.setPlaceFilter" />
    </section>
    <section v-if="area.legendReady && !phone" class="legend-section" aria-label="Legend">
      <LayerLegend :layer="area.layer" :values="thermalValues" />
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
.chips { margin-top: var(--space-3); }
</style>
