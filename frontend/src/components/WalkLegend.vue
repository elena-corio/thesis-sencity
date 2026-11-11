<script setup>
// Left of the walk (board Routes 5): the legend of the walk's layer, read only, and why there is nothing to change. The
// layer, season and time are fixed when the walk starts (Elena, 2026-11-11).
import { computed } from 'vue'
import { fixedLine } from '../lib/walk.js'
import { useWalkStore } from '../stores/walk.js'
import LayerLegend from './LayerLegend.vue'

const walk = useWalkStore()
const line = computed(() => fixedLine(walk.info))
</script>

<template>
  <aside class="panel legend" data-panel="layers" aria-label="Legend">
    <LayerLegend :layer="walk.layer" compact />
    <div class="rule" />
    <p class="fixed">{{ line }}</p>
  </aside>
</template>

<style scoped>
.legend { display: flex; flex-direction: column; gap: calc(var(--space-3) + 2px); padding: calc(var(--space-4) + 2px); }
.rule { height: var(--hairline); background: var(--line); }
/* --text-2, not the board's muted grey, which is under 4.5:1 on white. */
.fixed { margin: 0; font-size: var(--fs-xs); line-height: 1.45; color: var(--text-2); }
</style>
