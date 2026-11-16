<script setup>
// Left panel (boards Flow 1c, 2, 4), settings only: the area inputs and Analyse → Layer → Season and time (for Thermal
// and Overall) → Places → one line on what the layer's colours mean. The legend is never here (Elena, 2026-11-11): it is in
// the right card, and on a phone it floats on the map. On a phone this is the Settings tab of the sheet.
import { computed, ref } from 'vue'
import { layerNote } from '../lib/legend.js'
import { PLACE_FILTERS } from '../lib/place.js'
import { useAreaStore } from '../stores/area.js'
import AreaInputs from './AreaInputs.vue'
import ChoiceButtons from './ChoiceButtons.vue'
import LayerButtons from './LayerButtons.vue'
import SeasonTime from './SeasonTime.vue'
import FirstHint from './FirstHint.vue'

defineProps({ phone: Boolean, getCentre: { type: Function, default: () => null } })
const emit = defineEmits(['pick'])
const area = useAreaStore()
const menuOpen = ref(false)

/** Season and time matter for Thermal and Overall, not for Senses (photo ratings). */
const showWindow = computed(() => area.layer !== 'senses')
/** The Places buttons filter the map and the suggestions once the area's streets are loaded. */
const placesReady = computed(() => area.step === 'analysed' && area.load === 'ready')
</script>

<template>
  <aside :class="phone ? 'embedded' : ['panel', 'left', { 'menu-open': menuOpen }]" :data-panel="phone ? undefined : 'layers'"
         data-scrollable aria-label="Area, layers and places">
    <FirstHint id="area" :phone="phone" class="first-hint" />
    <AreaInputs class="area-inputs" :phone="phone" :get-centre="getCentre" @pan="emit('pick', $event)" @menu="menuOpen = $event" />
    <section>
      <h2 class="section-title">Layer</h2>
      <FirstHint id="layer" :phone="phone" class="first-hint" />
      <LayerButtons />
      <FirstHint v-if="showWindow" id="season" :phone="phone" class="first-hint season-hint" />
      <SeasonTime v-if="showWindow" :store="area" />
      <h2 class="section-title places-title">Places</h2>
      <FirstHint id="places" :phone="phone" class="first-hint" />
      <ChoiceButtons class="chips" label="Show places" :options="PLACE_FILTERS" :value="area.placeFilter"
                     :disabled="!placesReady" @choose="area.setPlaceFilter" />
    </section>
    <section>
      <p class="layer-note" data-testid="layer-note">{{ layerNote(area.layer, area.thermalWindow) }}</p>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
.first-hint { margin-bottom: var(--space-3); }
.season-hint { margin-top: var(--space-4); }
/* The suggestions float over the map, not inside the panel. */
.left.menu-open { overflow: visible; }
/* The inputs are a section too: the line between sections divides them from the layer. */
section + section { border-top: var(--hairline) solid var(--line); margin-top: var(--space-4); padding-top: var(--space-4); }
/* The inputs row and the first controls: a little less room above the Layer title. */
.area-inputs + section { padding-top: var(--space-1); }
.places-title { margin-top: var(--space-4); }
.chips { margin-top: var(--space-3); }
.layer-note { margin: 0; font-size: var(--fs-sm); line-height: var(--lh); color: var(--text-2); }
</style>
