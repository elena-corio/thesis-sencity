<script setup>
// Start and End (boards Routes 1–4; phone P3 at the top with a swap button). On desktop this panel also
// has "Colour the routes by" and the legend. Only Thermal exists until rating is built.
import { computed, ref } from 'vue'
import { thermalLegend } from '../lib/thermal.js'
import { useRoutesStore } from '../stores/routes.js'
import AppIcon from './AppIcon.vue'
import PlaceSearch from './PlaceSearch.vue'
import RouteLayerButtons from './RouteLayerButtons.vue'

defineProps({
  phone: Boolean,
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick'])
const routes = useRoutesStore()
const menuOpen = ref(false)
const LEGEND = thermalLegend().map((l) => ({ label: l.label, color: `var(--${l.state})` }))
const active = computed(() => routes.hasResult)
const info = computed(() => routes.info)

function onPick(which, place) {
  emit('pick', place)
  routes.setPoint(which, place, place.name, true)
}
</script>

<template>
  <div v-if="phone" class="phone panel" data-panel="search">
    <div class="rows">
      <div class="row">
        <span class="mark start" aria-hidden="true" />
        <div class="field">
          <PlaceSearch field-id="route-start-phone-input" label="Start" placeholder="Start: search, or tap the map"
                       fallback="tap the map" :value="routes.start?.label ?? ''" :get-centre="getCentre"
                       @pick="onPick('start', $event)" @clear="routes.clearPoint('start')" />
        </div>
      </div>
      <div class="row">
        <span class="mark end" aria-hidden="true" />
        <div class="field">
          <PlaceSearch field-id="route-end-phone-input" label="End" placeholder="End: search, or tap the map"
                       fallback="tap the map" :value="routes.end?.label ?? ''" :get-centre="getCentre"
                       @pick="onPick('end', $event)" @clear="routes.clearPoint('end')" />
        </div>
      </div>
    </div>
    <button type="button" class="icon-btn swap" aria-label="Swap start and end" :disabled="!routes.start && !routes.end"
            @click="routes.swap()">
      <AppIcon name="swap" />
    </button>
  </div>

  <aside v-else class="panel left" :class="{ 'menu-open': menuOpen }" data-panel="layers" data-scrollable
         aria-label="Start, end and colours">
    <p class="field-label" id="route-start-label">Start</p>
    <div class="field">
      <PlaceSearch field-id="route-start-input" label="Start" placeholder="Search, or click on the map"
                   fallback="click on the map" :value="routes.start?.label ?? ''" :get-centre="getCentre"
                   @pick="onPick('start', $event)" @clear="routes.clearPoint('start')" @open="menuOpen = $event" />
    </div>
    <p class="field-label">End</p>
    <div class="field">
      <PlaceSearch field-id="route-end-input" label="End" placeholder="Search, or click on the map"
                   fallback="click on the map" :value="routes.end?.label ?? ''" :get-centre="getCentre"
                   @pick="onPick('end', $event)" @clear="routes.clearPoint('end')" @open="menuOpen = $event" />
    </div>
    <p class="note intro">SenCity finds two ways: the shortest, and the easiest that is at most a quarter longer.</p>

    <section class="colours">
      <h2 class="section-title">Colour the routes by</h2>
      <RouteLayerButtons />
      <template v-if="active">
        <p class="legend-title">Feels like temperature, hot or cold</p>
        <ul class="legend">
          <li v-for="s in LEGEND" :key="s.label"><span class="swatch" :style="{ background: s.color }" />{{ s.label }}</li>
          <li><span class="swatch" :style="{ background: 'var(--no-photo)' }" />No value</li>
        </ul>
        <p class="note source">
          Simulated by Infrared.city for {{ info.season }}, {{ info.time }}<template v-if="info.station?.name">,
          with weather from {{ info.station.name }}</template>. Standard limits, not personalised yet.
          Senses and Overall follow when your photos are rated.
        </p>
      </template>
      <ul v-else class="legend inactive">
        <li><span class="swatch" :style="{ background: 'var(--easy)' }" />Easy</li>
        <li><span class="swatch" :style="{ background: 'var(--mixed)' }" />Mixed</li>
        <li><span class="swatch" :style="{ background: 'var(--hard)' }" />Hard</li>
        <li><span class="swatch" :style="{ background: 'var(--no-photo)' }" />No value</li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
/* The suggestions float over the map, not inside the panel. */
.left.menu-open { overflow: visible; }
.field-label { margin: var(--space-3) 0 var(--space-1); font-size: var(--fs-sm); color: var(--text-2); }
.field-label:first-child { margin-top: 0; }
.field {
  position: relative; display: flex; align-items: center;
  min-height: var(--touch-phone); padding: 0 var(--space-1) 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: var(--ground);
}
.note { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.colours { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.legend-title { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.legend {
  list-style: none; padding: 0; margin: var(--space-3) 0 0;
  display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: var(--fs-sm);
}
.legend li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); flex: none; }

/* Below 1200 px the route card needs the room: the panel keeps Start, End and the colours (brief §3). */
@media (max-width: 1199px) {
  .intro, .source, .legend-title { display: none; }
}

.phone { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-2); }
.rows { flex: 1; min-width: 0; display: grid; gap: var(--space-2); }
.row { display: flex; align-items: center; gap: var(--space-2); }
.row .field { flex: 1; min-width: 0; }
.mark { flex: none; width: var(--route-mark); height: var(--route-mark); border-radius: 50%; }
.mark.start { border: var(--focus-width) solid var(--ring); }
.mark.end { background: var(--ring); }
.swap { width: var(--touch-phone); height: var(--touch-phone); flex: none; }
.swap:disabled { opacity: var(--inactive-opacity); }
</style>
