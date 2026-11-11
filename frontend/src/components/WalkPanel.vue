<script setup>
// Left panel of the walk (board Routes 5; on a phone the Settings of the sheet): Layer, season and time, and the
// legend. Here they only recolour the walked route (Elena, 2026-11-11). Overall stays disabled, as on the route card.
import { computed } from 'vue'
import { useRoutesStore } from '../stores/routes.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'
import LayerLegend from './LayerLegend.vue'
import RouteLayerButtons from './RouteLayerButtons.vue'
import SeasonTime from './SeasonTime.vue'

defineProps({ phone: Boolean })
defineEmits(['back'])
const walk = useWalkStore()
const routes = useRoutesStore()
const thermalValues = computed(() => [...routes.segments.values()].map((f) => f.properties.utci).filter((v) => v != null))
const NO_VALUE = [{ label: 'No value', color: 'var(--no-photo)' }]
const inactiveNote = computed(() => (walk.hasThermal ? '' : 'This route was found on Senses, so it has no thermal comfort.'))
</script>

<template>
  <aside :class="phone ? 'embedded' : ['panel', 'left']" :data-panel="phone ? undefined : 'layers'" data-scrollable
         aria-label="Layer and legend">
    <button v-if="phone" type="button" class="back" @click="$emit('back')"><AppIcon name="chevronLeft" /> Back to the walk</button>
    <section class="colours">
      <h2 class="section-title">Layer</h2>
      <RouteLayerButtons :store="walk" />
      <SeasonTime v-if="walk.layer !== 'senses'" :store="walk" :inactive-note="inactiveNote" />
    </section>
    <section class="legend-section" aria-label="Legend">
      <LayerLegend :layer="walk.layer" :values="thermalValues" :extra="NO_VALUE" />
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
.legend-section { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.back {
  display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--touch-phone);
  margin: 0 0 var(--space-2) calc(-1 * var(--space-1)); padding: 0 var(--space-2) 0 0;
  border: 0; background: transparent; color: var(--text-2); font-size: var(--fs-md);
}
</style>
