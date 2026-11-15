<script setup>
// Layer of the routes, as in Area. The two ways are found on Thermal; Senses colours them by their ratings as these
// arrive; Overall by the worse of the two (lib/overall.js).
import { useRoutesStore } from '../stores/routes.js'
import ChoiceButtons from './ChoiceButtons.vue'

const routes = useRoutesStore()
const LAYERS = [
  { id: 'senses', label: 'Senses' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'overall', label: 'Overall' },
]
</script>

<template>
  <ChoiceButtons class="layers" weight="thick" label="Layer" :options="LAYERS" :value="routes.layer"
                 :disabled="routes.load === 'loading'" @choose="routes.setLayer" />
</template>

<style scoped>
.layers { margin-top: var(--space-3); }
</style>
