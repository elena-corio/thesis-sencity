<script setup>
// Walk controls (boards Routes 5, P6): where you are ("0.35 of 1.6 km, 5 of 21 min") and previous / play or pause /
// next stretch. Keys anywhere in the walk: the arrows go to the previous or next stretch, space plays or pauses (not
// while a field, a choice, the tabs or another button has the focus, which keep their own keys). It opens paused.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { sectionLabel, stretchFeature } from '../lib/routes.js'
import { progressAt, progressLine } from '../lib/walk.js'
import { useRoutesStore } from '../stores/routes.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'

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
    <p class="line">{{ line }}</p>
    <div class="buttons">
      <button type="button" class="step" aria-label="Previous stretch" :aria-disabled="walk.index === 0" @click="walk.step(-1, $event.detail === 0)">
        <AppIcon name="skipBack" />
      </button>
      <button type="button" class="play" :aria-label="walk.playing ? 'Pause' : 'Play'" @click="walk.toggle()">
        <AppIcon :name="walk.playing ? 'pause' : 'play'" />
      </button>
      <button type="button" class="step" aria-label="Next stretch" :aria-disabled="walk.atEnd" @click="walk.step(1, $event.detail === 0)">
        <AppIcon name="skipNext" />
      </button>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ here }}</p>
  </div>
</template>

<style scoped>
.controls { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
.controls.phone { gap: calc(var(--space-2) - 2px); }
.line { margin: 0; font-size: var(--fs-xs); color: var(--text-2); font-variant-numeric: tabular-nums; text-align: center; }
.phone .line { font-size: var(--fs-2xs); }
.buttons { display: flex; gap: var(--space-2); justify-content: center; }
.step, .play {
  display: grid; place-items: center; height: var(--walk-step-btn); padding: 0;
  border-radius: var(--radius-btn); color: var(--text);
}
.step { width: var(--walk-step-btn); border: var(--hairline) solid var(--line); background: transparent; }
.step[aria-disabled="true"] { opacity: var(--inactive-opacity); }
.play { width: var(--walk-play-w); border: 0; background: var(--btn-primary-bg); color: var(--btn-primary-text); }
</style>
