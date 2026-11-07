<script setup>
// Layer on the map for Area: Senses, Thermal, Overall (one at a time). Thermal turns on once thermal
// comfort is ready; Senses and Overall wait for the rating. Used in the left panel, and in the area card
// when the left panel gives way (phone and below 1200 px), like RouteLayerButtons in Routes.
import { computed } from 'vue'
import { useAreaStore } from '../stores/area.js'

const area = useAreaStore()
const LAYERS = [{ id: 'senses', label: 'Senses' }, { id: 'thermal', label: 'Thermal' }, { id: 'overall', label: 'Overall' }]
const ready = (id) => id === 'thermal' && area.thermal === 'ready'
const anyReady = computed(() => LAYERS.some((l) => ready(l.id)))
</script>

<template>
  <div class="layers" :class="{ inactive: !anyReady }" role="group" aria-label="Layer">
    <button v-for="l in LAYERS" :key="l.id" type="button" class="seg" :class="{ on: area.layer === l.id }"
            :disabled="!ready(l.id)" :aria-pressed="area.layer === l.id" @click="area.layer = l.id">
      {{ l.label }}
    </button>
  </div>
</template>

<style scoped>
.layers { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-3); }
.seg {
  min-height: var(--touch); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; font-size: var(--fs-md);
}
.seg.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.layers:not(.inactive) .seg:disabled { opacity: var(--inactive-opacity); }
@media (pointer: coarse) { .seg { min-height: var(--touch-phone); } }
</style>
