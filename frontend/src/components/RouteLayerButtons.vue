<script setup>
// Layer of the routes, as in Area. Only Thermal for now: the easiest way is found from the states along it,
// so Senses and Overall wait until photos are rated.
import { useRoutesStore } from '../stores/routes.js'
import ChoiceButtons from './ChoiceButtons.vue'

const routes = useRoutesStore()
const SOON = 'Follows when your photos are rated'
const LAYERS = [
  { id: 'senses', label: 'Senses', disabled: true, title: SOON },
  { id: 'thermal', label: 'Thermal' },
  { id: 'overall', label: 'Overall', disabled: true, title: SOON },
]
</script>

<template>
  <ChoiceButtons class="layers" weight="thick" label="Layer" :options="LAYERS" :value="routes.layer"
                 :disabled="routes.load === 'loading'" />
</template>

<style scoped>
.layers { margin-top: var(--space-3); }
</style>
