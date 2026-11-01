<script setup>
// Bottom right: zoom + / − and re-centre (on the area, or on the start view).
import AppIcon from './AppIcon.vue'

defineEmits(['zoom-in', 'zoom-out', 'recentre'])
</script>

<template>
  <div class="controls panel" data-panel="controls" role="group" aria-label="Map controls">
    <button type="button" class="icon-btn" aria-label="Zoom in" @click="$emit('zoom-in')"><AppIcon name="plus" /></button>
    <button type="button" class="icon-btn" aria-label="Zoom out" @click="$emit('zoom-out')"><AppIcon name="minus" /></button>
    <span class="divider" aria-hidden="true" />
    <button type="button" class="icon-btn" aria-label="Re-centre the map" @click="$emit('recentre')"><AppIcon name="locate" /></button>
  </div>
</template>

<style scoped>
.controls { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-1); }
.icon-btn { width: var(--control-size); height: var(--control-size); }
.divider { width: 70%; height: var(--hairline); background: var(--line); }
</style>
