<script setup>
// A selected stretch (board Routes 4): the same card as a place on the map (brief §3 "one card pattern"),
// with the route bar above it and coverage and previous / next below. Arrow keys step along the route.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { formatKm, stretchFeature, stretchLine } from '../lib/routes.js'
import { useRoutesStore } from '../stores/routes.js'
import AppIcon from './AppIcon.vue'
import PlaceCard from './PlaceCard.vue'
import RouteBar from './RouteBar.vue'

defineProps({ phone: Boolean })
const routes = useRoutesStore()
const stretch = computed(() => routes.selectedStretch)
const route = computed(() => routes.selectedRoute)
const feature = computed(() => stretchFeature(stretch.value, routes.segments))
const count = computed(() => route.value.stretches.length)

const source = computed(() => ({
  key: stretch.value.key,
  feature: feature.value,
  layer: routes.layer,
  info: routes.info,
  features: null, // no "nearest street" suggestions: the card is about this way
  backLabel: 'Back to comparison',
  subtitle: stretchLine(stretch.value),
  byKeyboard: routes.byKeyboard,
  back: (keyboard) => routes.back(keyboard),
}))

const coverage = computed(() => {
  const f = feature.value.properties
  const n = f.photos?.length ?? 0
  return n ? `Based on ${n} photo${n > 1 ? 's' : ''} along this stretch.` : 'No photo along this stretch.'
})

function onKey(e) {
  if (e.defaultPrevented || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
  if (e.target.closest?.('input, select, [data-viewer]')) return
  e.preventDefault()
  routes.stepStretch(e.key === 'ArrowLeft' ? -1 : 1, true)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <PlaceCard v-if="stretch" :source="source" :phone="phone">
    <template #head>
      <p class="where">
        <span>Route {{ route.id }} · stretch {{ stretch.index + 1 }} of {{ count }}</span>
        <span class="muted">{{ formatKm(route.length_m) }}</span>
      </p>
      <RouteBar :route="route" />
    </template>
    <template #foot>
      <p class="coverage">{{ coverage }}</p>
      <!-- Stays in view while the card scrolls on a short screen. -->
      <div class="steps">
        <button type="button" class="btn" :disabled="stretch.index === 0" @click="routes.stepStretch(-1)">
          <AppIcon name="chevronLeft" /> Previous stretch
        </button>
        <button type="button" class="btn" :disabled="stretch.index === count - 1" @click="routes.stepStretch(1)">
          Next stretch <AppIcon name="chevronRight" />
        </button>
      </div>
    </template>
    <slot />
  </PlaceCard>
</template>

<style scoped>
.where { display: flex; justify-content: space-between; gap: var(--space-3); margin: var(--space-1) 0 0; font-size: var(--fs-sm); }
.muted { color: var(--text-2); }
.coverage { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.steps {
  position: sticky; bottom: calc(-1 * var(--space-5)); z-index: 1;
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);
  margin: var(--space-3) 0 calc(-1 * var(--space-5)); padding: var(--space-2) 0 var(--space-5);
  background: var(--panel);
}
.steps .btn { background: var(--panel); }
.steps .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1);
  padding: 0 var(--space-1); font-size: var(--fs-sm); white-space: normal;
}
.steps .btn:disabled { opacity: var(--inactive-opacity); }
</style>
