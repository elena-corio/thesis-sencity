<script setup>
// The buildings could not be loaded (in the style of the States board, "Offline"): what happened, what still works,
// and Retry. The walk goes on, on a flat map.
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'

const walk = useWalkStore()
</script>

<template>
  <div v-if="walk.buildingsState === 'error'" class="notice panel" role="status" data-panel="walk-chip">
    <AppIcon name="warning" class="warn" />
    <span class="text">{{ walk.buildingsError }} The walk goes on, without buildings.</span>
    <button type="button" class="btn" @click="walk.fetchBuildings()">Retry</button>
  </div>
</template>

<style scoped>
.notice {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) calc(var(--space-4) + 2px); border-radius: var(--radius-btn);
}
.warn { flex: none; color: var(--warning); }
.text { flex: 1; min-width: 0; }
.btn { font-size: var(--fs-sm); }
</style>
