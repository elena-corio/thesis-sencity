<script setup>
// Layer for Area, as in Routes. Senses gives one prediction per street clicked; Overall needs every street
// rated, so it waits. Used in the left panel, and in the area card when the left panel gives way.
import { useAreaStore } from '../stores/area.js'
import ChoiceButtons from './ChoiceButtons.vue'

const area = useAreaStore()
const SOON = 'Follows when your photos are rated'
const LAYERS = [
  { id: 'senses', label: 'Senses' },
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
