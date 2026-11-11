<script setup>
// Layer of the routes, as in Area. The two ways are found on Thermal; Senses colours them by their ratings as these
// arrive. Overall needs both for every street, so it waits.
import { useRoutesStore } from '../stores/routes.js'
import ChoiceButtons from './ChoiceButtons.vue'

const routes = useRoutesStore()
const SOON = 'Follows when your photos are rated'
const LAYERS = [
  { id: 'senses', label: 'Senses' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'overall', label: 'Overall', disabled: true, title: SOON },
]
</script>

<template>
  <ChoiceButtons class="layers" weight="thick" label="Layer" :options="LAYERS" :value="routes.layer"
                 :disabled="routes.load === 'loading'" @choose="routes.setLayer" />
</template>

<style scoped>
.layers { margin-top: var(--space-3); }
</style>
