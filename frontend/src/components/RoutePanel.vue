<script setup>
// Routes left panel (boards Routes 1–4; desktop and tablet; on a phone the sheet has the same), settings only: the walk
// inputs and Analyse, then Layer, season and time, then one line on what the layer's colours mean. The legend is in the
// route card (Elena, 2026-11-11).
import { ref } from 'vue'
import { useRoutesStore } from '../stores/routes.js'
import { layerNote } from '../lib/legend.js'
import RouteInputs from './RouteInputs.vue'
import RouteLayerButtons from './RouteLayerButtons.vue'
import SeasonTime from './SeasonTime.vue'
import FirstHint from './FirstHint.vue'

defineProps({
  /** The Settings tab of the phone sheet: no panel of its own, and the legend floats on the map instead. */
  phone: Boolean,
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick'])
const routes = useRoutesStore()
const menuOpen = ref(false)
</script>

<template>
  <aside :class="phone ? 'embedded' : ['panel', 'left', { 'menu-open': menuOpen }]" :data-panel="phone ? undefined : 'layers'"
         data-scrollable aria-label="Start, end and colours">
    <FirstHint id="routes" :phone="phone" class="first-hint" />
    <RouteInputs :phone="phone" :get-centre="getCentre" @pan="emit('pick', $event)" @menu="menuOpen = $event" />

    <section class="colours">
      <h2 class="section-title">Layer</h2>
      <RouteLayerButtons />
      <!-- Season and time matter for Thermal and Overall, not for Senses. -->
      <SeasonTime v-if="routes.layer !== 'senses'" :store="routes" />
    </section>
    <section class="note-section">
      <p class="layer-note" data-testid="layer-note">{{ layerNote(routes.layer, routes.thermalWindow) }}</p>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
.first-hint { margin-bottom: var(--space-4); }
/* The suggestions float over the map, not inside the panel. */
.left.menu-open { overflow: visible; }
/* Inputs first, then a divider (when there are inputs), then the layer; the legend is last, after a divider. */
.note-section { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.layer-note { margin: 0; font-size: var(--fs-sm); line-height: var(--lh); color: var(--text-2); }
.colours { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.colours:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
</style>
