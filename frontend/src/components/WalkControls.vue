<script setup>
// Walk controls (WalkView): play or pause, where you are ("0.35 of 1.6 km, 5 of 21 min") and the route bar, coloured as
// the walk rates its stretches (a click jumps there). Previous and next stretch are the arrows beside the photo. Keys
// anywhere in the walk: the arrows go to the previous or next stretch, space plays or pauses (not while a field, a
// choice, the tabs or another button has the focus, which keep their own keys).
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { sectionLabel, stretchFeature } from '../lib/routes.js'
import { progressAt, progressLine } from '../lib/walk.js'
import { useRoutesStore } from '../stores/routes.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'
import RouteBar from './RouteBar.vue'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const routes = useRoutesStore()
const line = computed(() => progressLine(progressAt(walk.stretches, walk.index), walk.route.minutes))
/** For screen readers: where you are now. */
const here = computed(() => {
  const s = walk.current
  if (!s) return ''
  const f = stretchFeature(s, routes.segments).properties
  return `Stretch ${walk.index + 1} of ${walk.stretches.length}: ${sectionLabel(s, walk.stretches.length, f.name, f.utci)}`
})

function onKey(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const t = e.target
  if (t.closest?.('input, select, textarea, [role="radiogroup"], [role="tablist"], [data-viewer]')) return
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    walk.step(e.key === 'ArrowLeft' ? -1 : 1, true)
  } else if (e.key === ' ' && !t.closest?.('button, a')) {
    e.preventDefault()
    walk.toggle()
  }
}
// One listener, whichever controls are on screen (the desktop card or the phone sheet).
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="controls" :class="{ phone }" role="group" aria-label="Walk controls">
    <div class="row">
      <button type="button" class="play" :aria-label="walk.playing ? 'Pause' : 'Play'" @click="walk.toggle()">
        <AppIcon :name="walk.playing ? 'pause' : 'play'" />
      </button>
      <div class="track">
        <RouteBar v-if="walk.shown && walk.current" :route="walk.shown" :current="walk.current.key"
                  @pick="(i, keyboard) => walk.go(i, keyboard)" />
        <p class="line">{{ line }}</p>
      </div>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ here }}</p>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: var(--space-4); }
.track { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.line { margin: 0; font-size: var(--fs-xs); color: var(--text-2); font-variant-numeric: tabular-nums; }
.phone .line { font-size: var(--fs-2xs); }
.play {
  flex: none; display: grid; place-items: center; width: var(--walk-play-w); height: var(--walk-step-btn); padding: 0;
  border: 0; border-radius: var(--radius-btn); background: var(--btn-primary-bg); color: var(--btn-primary-text);
}
</style>
