<script setup>
// Layer for Area, as in Routes. Only Thermal for now: Senses and Overall are not built yet. Used in the left
// panel, and in the area card when the left panel gives way.
import { useAreaStore } from '../stores/area.js'
import ChoiceButtons from './ChoiceButtons.vue'

const area = useAreaStore()
const SOON = 'Follows when your photos are rated'
const LAYERS = [
  { id: 'senses', label: 'Senses', disabled: true, title: SOON },
  { id: 'thermal', label: 'Thermal' },
  { id: 'overall', label: 'Overall', disabled: true, title: SOON },
]
</script>

<template>
  <ChoiceButtons class="layers" weight="thick" label="Layer" :options="LAYERS" :value="area.layer" :disabled="area.busy"
                 @choose="area.setLayer" />
</template>

<style scoped>
.layers { margin-top: var(--space-3); }
</style>
