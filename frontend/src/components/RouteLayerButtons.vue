<script setup>
// "Colour the routes by": Senses, Thermal, Overall. Inactive until the routes are ready, and Senses and
// Overall stay inactive until rating is built.
import { useRoutesStore } from '../stores/routes.js'

const routes = useRoutesStore()
const LAYERS = [{ id: 'senses', label: 'Senses' }, { id: 'thermal', label: 'Thermal' }, { id: 'overall', label: 'Overall' }]
</script>

<template>
  <div class="layers" :class="{ inactive: !routes.hasResult }">
    <button v-for="l in LAYERS" :key="l.id" type="button" class="seg" :class="{ on: routes.layer === l.id }"
            :disabled="l.id !== 'thermal' || !routes.hasResult" :aria-pressed="routes.layer === l.id"
            :title="l.id === 'thermal' ? undefined : 'Follows when your photos are rated'">
      {{ l.label }}
    </button>
  </div>
</template>

<style scoped>
.layers { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-3); }
.seg {
  min-height: var(--touch); padding: 0 var(--space-1);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; font-size: var(--fs-md);
}
.seg.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.layers:not(.inactive) .seg:disabled { opacity: var(--inactive-opacity); }
</style>
