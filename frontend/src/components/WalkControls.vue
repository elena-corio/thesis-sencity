<script setup>
// Walk controls (boards Routes 5, P6): Start → End with where you are, the strip of stretches (each one a button,
// as long as its walk), previous / play or pause / next, and Exit walk. Keys anywhere in the walk: the arrows go to
// the previous or next stretch, space pauses or plays (not while a field, a choice or another button has the focus,
// which keep their own keys). It opens paused; with reduced motion the camera jumps between stretches.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { sectionLabel, stretchFeature } from '../lib/routes.js'
import { progressAt, progressLine } from '../lib/walk.js'
import { useRoutesStore } from '../stores/routes.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const routes = useRoutesStore()
const progress = computed(() => progressAt(walk.stretches, walk.index))
const line = computed(() => progressLine(progress.value, walk.route.minutes))
const total = computed(() => walk.stretches.length)
const name = (s) => stretchFeature(s, routes.segments).properties.name
const label = (s) => sectionLabel(s, total.value, name(s), stretchFeature(s, routes.segments).properties.utci)
const stripLabel = computed(() => `Route ${walk.route.id} along the way, ${total.value} stretches`)
/** For screen readers: where you are now. */
const here = computed(() => walk.current && `Stretch ${walk.index + 1} of ${total.value}: ${label(walk.current)}`)

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
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="controls" :class="phone ? 'phone' : 'panel'" :data-panel="phone ? undefined : 'walk-controls'" aria-label="Walk controls">
    <div class="ends"><span>Start</span><span class="line">{{ line }}</span><span>End</span></div>
    <div class="track">
      <div class="strip" role="group" :aria-label="stripLabel">
        <button v-for="(s, i) in walk.stretches" :key="s.key" type="button" class="section" :data-stretch="s.key"
                :class="{ on: i === walk.index, change: i > 0 && walk.stretches[i - 1].state !== s.state }"
                :style="{ flexGrow: s.length_m }" :aria-label="label(s)" :aria-current="i === walk.index ? 'step' : undefined"
                @click="walk.go(i, $event.detail === 0)">
          <span :class="['fill', s.state]" />
        </button>
      </div>
      <span class="marker" aria-hidden="true" :style="{ left: `${progress.share * 100}%` }" />
    </div>
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
      <button type="button" class="btn exit" @click="walk.exit($event.detail === 0)">Exit walk</button>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ here }}</p>
  </section>
</template>

<style scoped>
.controls { display: flex; flex-direction: column; gap: var(--space-3); }
.controls.panel { width: var(--walk-controls-w); max-width: 100%; padding: var(--space-4) calc(var(--space-4) + 2px); }
.ends { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--fs-xs); color: var(--text-2); }
.line { font-variant-numeric: tabular-nums; text-align: center; }

.track { position: relative; }
.strip { display: flex; min-width: 0; }
.section {
  flex: 1 1 0; min-width: var(--bar-min-section); height: var(--bar-hit-h);
  display: flex; align-items: center; padding: 0; border: 0; background: transparent;
}
.section.change { margin-left: var(--bar-gap); }
.fill { display: block; width: 100%; height: var(--bar-h); opacity: var(--bar-state-opacity); }
.section:first-child .fill { border-radius: var(--bar-radius) 0 0 var(--bar-radius); }
.section:last-child .fill { border-radius: 0 var(--bar-radius) var(--bar-radius) 0; }
.section:only-child .fill { border-radius: var(--bar-radius); }
.fill.easy { background: var(--easy); }
.fill.mixed { background: var(--mixed); }
.fill.hard { background: var(--hard); opacity: 1; }
.fill.none { background: var(--no-photo); }
.section:hover .fill, .section.on .fill { opacity: 1; }
.marker {
  position: absolute; top: 50%; width: var(--walk-marker-w); height: var(--walk-marker-h);
  border-radius: var(--radius-pill); background: var(--text); box-shadow: var(--walk-marker-glow);
  transform: translate(-50%, -50%); pointer-events: none; transition: left var(--transition);
}

.buttons { position: relative; display: flex; align-items: center; justify-content: center; gap: var(--space-2); }
.step, .play {
  display: grid; place-items: center; height: var(--walk-step-btn); padding: 0;
  border-radius: var(--radius-btn); color: var(--text);
}
.step { width: var(--walk-step-btn); border: var(--hairline) solid var(--line); background: transparent; }
.step[aria-disabled="true"] { opacity: var(--inactive-opacity); }
.play { width: var(--walk-play-w); border: 0; background: var(--btn-primary-bg); color: var(--btn-primary-text); }
.exit { position: absolute; right: 0; top: 0; min-height: var(--walk-step-btn); font-size: var(--fs-sm); font-weight: var(--fw-regular); }

/* Phone (board P6): at the top of the sheet. */
.phone { gap: var(--space-2); }
.phone .ends { font-size: var(--fs-2xs); }
</style>
