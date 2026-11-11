<script setup>
// Right of the walk on desktop (board Routes 5): "Exit walk, back to comparison", the key of the walk's layer and window
// and why there is nothing to change (the walk has no left panel, Elena 2026-11-11), "Where you are" (a small map that
// follows you; a stretch is clickable), the progress line and previous / play / next. No segment bar.
import { fixedLine } from '../lib/walk.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'
import ComfortKey from './ComfortKey.vue'
import WalkControls from './WalkControls.vue'
import WalkMiniMap from './WalkMiniMap.vue'

const walk = useWalkStore()
</script>

<template>
  <section class="side panel" data-panel="walk-side" aria-label="Where you are and walk controls">
    <button type="button" class="back" @click="walk.exit($event.detail === 0)"><AppIcon name="chevronLeft" /> Exit walk, back to comparison</button>
    <ComfortKey :layer="walk.layer" :window="walk.info" />
    <p class="fixed">{{ fixedLine() }}</p>
    <div class="rule" />
    <p class="where"><span class="title">Where you are</span><span class="hint">follows you</span></p>
    <WalkMiniMap />
    <WalkControls />
  </section>
</template>

<style scoped>
.side { display: flex; flex-direction: column; gap: var(--space-3); padding: calc(var(--space-3) + 2px) var(--space-4) var(--space-4); }
.back {
  display: inline-flex; align-self: flex-start; align-items: center; gap: var(--space-2); min-height: var(--touch-phone);
  padding: 0; border: 0; background: transparent; color: var(--text-2); font-size: var(--fs-sm);
}
.back :deep(.icon) { width: var(--icon-sm); height: var(--icon-sm); }
.rule { height: var(--hairline); background: var(--line); }
/* --text-2, not the board's muted grey, which is under 4.5:1 on white. */
.fixed { margin: 0; font-size: var(--fs-xs); line-height: 1.45; color: var(--text-2); }
.where { display: flex; justify-content: space-between; align-items: baseline; margin: 0; }
.title { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.hint { font-size: var(--fs-2xs); color: var(--text-2); }
</style>
