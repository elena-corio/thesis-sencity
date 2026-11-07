<script setup>
// Routes left panel (boards Routes 1–4; desktop and tablet; on a phone the sheet has the same). The walk
// inputs (one row, opened to type), then Layer, season and time, and the legend last (after a divider,
// once the routes are ready). Only Thermal exists until rating is built.
import { computed, ref } from 'vue'
import { useRoutesStore } from '../stores/routes.js'
import RouteInputs from './RouteInputs.vue'
import RouteLayerButtons from './RouteLayerButtons.vue'
import SeasonTime from './SeasonTime.vue'
import ThermalLegend from './ThermalLegend.vue'

defineProps({
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick'])
const routes = useRoutesStore()
const menuOpen = ref(false)
/** Feels-like values of the streets along the routes, for the season and time shown. */
const thermalValues = computed(() => [...routes.segments.values()].map((f) => f.properties.utci).filter((v) => v != null))
const NO_VALUE = [{ label: 'No value', color: 'var(--no-photo)' }]
const active = computed(() => routes.hasResult)
</script>

<template>
  <aside class="panel left" :class="{ 'menu-open': menuOpen }" data-panel="layers" data-scrollable
         aria-label="Start, end and colours">
    <RouteInputs :get-centre="getCentre" @pan="emit('pick', $event)" @menu="menuOpen = $event" />

    <section class="colours">
      <h2 class="section-title">Layer</h2>
      <RouteLayerButtons />
      <!-- Season and time matter for Thermal and Overall, not for Senses. -->
      <SeasonTime v-if="routes.layer !== 'senses'" :store="routes" />
    </section>
    <!-- The legend only once the routes are ready (the source is in its tooltip). -->
    <section v-if="active" class="legend-section" aria-label="Legend">
      <ThermalLegend :values="thermalValues" :extra="NO_VALUE" />
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
/* The suggestions float over the map, not inside the panel. */
.left.menu-open { overflow: visible; }
/* Inputs first, then a divider (when there are inputs), then the layer; the legend is last, after a divider. */
.legend-section { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.colours { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.colours:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
</style>
