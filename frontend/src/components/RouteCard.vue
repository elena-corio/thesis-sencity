<script setup>
// "Which way feels better?" (boards Routes 1–3; phone P3): the three steps, the preview ("This walk",
// nothing is asked for before Analyse, as in Area), the progress, or the comparison. A bottom sheet on a phone.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import config from '../config.js'
import { formatCoords } from '../lib/geo.js'
import { formatKm, formatLength } from '../lib/routes.js'
import { useRoutesStore } from '../stores/routes.js'
import AppIcon from './AppIcon.vue'
import RouteBar from './RouteBar.vue'
import RouteLayerButtons from './RouteLayerButtons.vue'
import SeasonTime from './SeasonTime.vue'

const props = defineProps({ phone: Boolean })
const routes = useRoutesStore()
const cancelBtn = ref(null)
const analyseBtn = ref(null)
const verb = computed(() => (props.phone ? 'Tap' : 'Click'))
const pct = (x) => `${Math.round(x * 100)}%`

const pointText = (p) => (p.named ? p.label : formatCoords(p))
function startAgain() {
  routes.reset()
  routes.byKeyboard && document.querySelector('canvas')?.focus()
}
// Keyboard: after Enter sets the end, focus goes to Analyse, then to Cancel (as in Area).
watch(() => routes.previewing, async (on) => {
  if (!on || !routes.byKeyboard) return
  await nextTick()
  analyseBtn.value?.focus()
})
watch(() => routes.load, async (load) => {
  if (load !== 'loading' || !routes.byKeyboard) return
  await nextTick()
  cancelBtn.value?.focus()
})

// Going back from a stretch: focus returns to its bar section.
onMounted(() => {
  if (routes.byKeyboard && routes.returnKey) {
    nextTick(() => document.querySelector(`[data-stretch="${CSS.escape(routes.returnKey)}"]`)?.focus())
  }
})

const STAGES = ['streets', 'photos', 'thermal', 'routes']
const stageIndex = computed(() => STAGES.indexOf(routes.progress.stage))
const failedAt = computed(() => (routes.load === 'error' ? routes.progress.failed ?? routes.progress.stage : null))
/** 'done' | 'active' | 'next' | 'failed' for a loading row. */
function rowState(stage) {
  if (failedAt.value === stage) return 'failed'
  const i = STAGES.indexOf(stage)
  if (i < stageIndex.value) return 'done'
  return i === stageIndex.value && routes.load === 'loading' ? 'active' : 'next'
}
const share = computed(() => {
  const p = routes.progress
  return p.total ? Math.round((100 * p.done) / p.total) : 0
})
const loading = computed(() => routes.load === 'loading' || routes.load === 'error')

const bName = (r) => (r.kind === 'easiest' ? 'easiest' : 'alternative')
const hardColour = (r) => (r.hard_share === 0 ? 'clear' : '')
const coverage = computed(() => {
  const [a, b] = routes.shown
  const each = (key) => {
    if (!b) return `${pct(a[key])} of A`
    return pct(a[key]) === pct(b[key]) ? `${pct(a[key])} of A and B` : `${pct(a[key])} of A and ${pct(b[key])} of B`
  }
  return `Thermal along ${each('thermal_share')}, photos along ${each('photo_share')}.`
})

function onEnter(id) { routes.hoverRoute = id }
function onLeave() { routes.hoverRoute = null }
</script>

<template>
  <section class="card panel" :class="{ sheet: phone }" data-panel="route-card" data-scrollable aria-labelledby="route-title">
    <div v-if="phone" class="grip" aria-hidden="true" />

    <!-- Loading (board Routes 2): no routes on the map yet. -->
    <template v-if="loading">
      <div class="head">
        <div>
          <h2 id="route-title" class="title">Comparing two ways</h2>
          <p class="meta">Loading the streets between start and end</p>
        </div>
        <button type="button" class="icon-btn" aria-label="Cancel" @click="routes.cancel()"><AppIcon name="close" /></button>
      </div>
      <ul class="steps">
        <li :class="rowState('streets')">
          <AppIcon :name="rowState('streets') === 'done' ? 'check' : 'pending'" />
          <span class="label">Streets between start and end</span>
          <span v-if="rowState('streets') === 'active'" class="progress waiting" aria-hidden="true"><span /></span>
        </li>
        <li :class="rowState('photos')">
          <AppIcon :name="rowState('photos') === 'done' ? 'check' : 'pending'" />
          <span class="label">Street photos</span>
          <span v-if="rowState('photos') === 'active'" class="detail" role="status">{{ routes.progress.done }} of {{ routes.progress.total }}</span>
          <span v-if="rowState('photos') === 'active'" class="progress" aria-hidden="true"><span :style="{ width: `${share}%` }" /></span>
        </li>
        <li :class="rowState('thermal')">
          <AppIcon :name="rowState('thermal') === 'done' ? 'check' : 'pending'" />
          <span class="label">Thermal</span>
          <span class="detail">{{ routes.thermalWindow.season }}, {{ routes.thermalWindow.time }}</span>
          <span v-if="rowState('thermal') === 'active'" class="progress waiting" aria-hidden="true"><span /></span>
        </li>
        <li class="next">
          <AppIcon name="pending" /><span class="label">Rating for your profile</span>
        </li>
      </ul>
      <p v-if="routes.load === 'error'" class="note error" role="alert">{{ routes.error }}</p>
      <p v-else-if="routes.hasResult" class="note">
        The ways on the map are for {{ routes.info.season }}, {{ routes.info.time }} until the new ones are ready.
      </p>
      <p v-else-if="routes.progress.stage === 'thermal'" class="note">
        Simulating sun, shade and wind along the way. This can take a few minutes.
      </p>
      <p v-else class="note">The two ways appear once the streets between start and end are ready. A new route takes a few minutes.</p>
      <div class="buttons">
        <button v-if="routes.load === 'error'" type="button" class="btn btn-primary" @click="routes.find({ resume: true })">Try again</button>
        <button ref="cancelBtn" type="button" class="btn" @click="routes.cancel()">
          {{ routes.load === 'error' ? 'Back' : 'Cancel' }}
        </button>
      </div>
    </template>

    <!-- The comparison (board Routes 3). -->
    <template v-else-if="routes.hasResult">
      <template v-if="phone">
        <div class="colour-by">
          <span class="by-label">Colour by</span>
          <RouteLayerButtons class="by-buttons" />
        </div>
        <SeasonTime v-if="routes.layer !== 'senses'" class="window" :store="routes" />
      </template>
      <h2 id="route-title" class="title">Which way feels better?</h2>
      <div class="route-buttons" :class="{ one: routes.shown.length === 1 }">
        <button v-for="r in routes.shown" :key="r.id" type="button" class="route-btn" :class="{ on: routes.visible[r.id] }"
                :aria-pressed="routes.visible[r.id]" :aria-label="`Route ${r.id}, ${r.id === 'A' ? 'shortest' : bName(r)}: show or hide`"
                @mouseenter="onEnter(r.id)" @mouseleave="onLeave" @focus="onEnter(r.id)" @blur="onLeave"
                @click="routes.toggleRoute(r.id)">
          <span :class="['sample', r.id]" aria-hidden="true" />
          {{ r.id }} · {{ r.id === 'A' ? 'shortest' : bName(r) }}
        </button>
      </div>
      <div v-for="r in routes.shown" :key="r.id" class="route" :data-route="r.id">
        <p class="route-line">
          <span :class="['sample', r.id]" aria-hidden="true" />
          <strong>{{ r.id }}</strong>
          <span class="muted">{{ formatKm(r.length_m) }} · {{ r.minutes }} min</span>
          <span class="hard" :class="hardColour(r)">hard {{ pct(r.hard_share) }}</span>
        </p>
        <div class="bar-row">
          <span class="muted bar-label">Thermal</span>
          <RouteBar :route="r" />
        </div>
      </div>
      <p class="verdict">{{ routes.verdict }}</p>
      <p v-if="routes.windowError" class="window-error" role="status">{{ routes.windowError }}</p>
      <p class="foot">
        {{ coverage }} {{ verb }} a stretch on the map or a section of a bar to see it. Predictions, not reasons.
      </p>
    </template>

    <!-- Both points set: check before anything is fetched or billed (as Flow 1c in Area). -->
    <template v-else-if="routes.previewing">
      <h2 id="route-title" class="title">This walk</h2>
      <dl class="points">
        <div><dt><span class="mark start" aria-hidden="true" />Start</dt><dd :title="pointText(routes.start)">{{ pointText(routes.start) }}</dd></div>
        <div><dt><span class="mark end" aria-hidden="true" />End</dt><dd :title="pointText(routes.end)">{{ pointText(routes.end) }}</dd></div>
      </dl>
      <ul class="facts">
        <li><AppIcon name="route" /> {{ formatLength(routes.aerialDistance) }} in a straight line</li>
        <li><AppIcon name="thermometer" /> Thermal for {{ routes.thermalWindow.season }}, {{ routes.thermalWindow.time }}</li>
        <li><AppIcon name="clock" /> Ready in a few minutes</li>
      </ul>
      <!-- Phone: the season and time are chosen here before Analyse (desktop: in the left panel). -->
      <SeasonTime v-if="phone && routes.layer !== 'senses'" :store="routes" />
      <div class="buttons">
        <button ref="analyseBtn" type="button" class="btn btn-primary grow" @click="routes.find()">Analyse this walk</button>
        <button type="button" class="btn" @click="startAgain">Start again</button>
      </div>
    </template>

    <!-- Choosing the points (board Routes 1). -->
    <template v-else>
      <h2 id="route-title" class="title">Which way feels better?</h2>
      <ol class="choose">
        <li :class="{ done: routes.start }">
          <span class="num"><AppIcon v-if="routes.start" name="check" /><template v-else>1</template></span>
          Choose where you start
        </li>
        <li :class="{ done: routes.end, now: routes.start && !routes.end }">
          <span class="num">2</span>
          Choose where you want to go
        </li>
        <li><span class="num">3</span> See two ways side by side</li>
      </ol>
      <p v-if="routes.pointError" class="note error" role="alert">{{ routes.pointError }}</p>
      <p class="foot">
        {{ verb }} on the map or search. Walking routes up to about {{ formatKm(config.routes.maxM) }}.
        Photos and thermal comfort are loaded along both routes.
      </p>
    </template>
    <slot />
  </section>
</template>

<style scoped>
.card { padding: var(--space-5); overflow-y: auto; }
.title { margin: 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.meta { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.muted { color: var(--text-2); }

.choose { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
.choose li { display: flex; align-items: center; gap: var(--space-3); color: var(--text-2); }
.choose li.now { color: var(--text); }
.num {
  width: var(--step-mark); height: var(--step-mark); flex: none; display: grid; place-items: center;
  border: var(--hairline) solid var(--line); border-radius: 50%; font-size: var(--fs-sm); font-weight: var(--fw-semibold);
}
.choose li.done .num { border-color: transparent; color: var(--easy); }
.choose li.now .num { border-color: var(--text); }
.foot { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.points { margin: var(--space-3) 0 0; display: grid; gap: var(--space-2); }
.points > div { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-3); min-width: 0; }
.points dt { display: flex; align-items: center; gap: var(--space-2); color: var(--text-2); font-size: var(--fs-sm); min-width: var(--route-point-label); }
.points dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.mark { flex: none; width: var(--route-mark); height: var(--route-mark); border-radius: 50%; }
.mark.start { border: var(--focus-width) solid var(--ring); }
.mark.end { background: var(--ring); }
.facts { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.facts li { display: flex; align-items: center; gap: var(--space-3); }
.facts :deep(.icon) { color: var(--text-2); }
.grow { flex: 1; }

.steps { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
.steps li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-1) var(--space-3); }
.steps .label { font-weight: var(--fw-medium); }
.steps .detail { font-size: var(--fs-sm); color: var(--text-2); }
.steps li.next { opacity: var(--inactive-opacity); }
.steps li.done :deep(.icon) { color: var(--easy); }
.steps li.active :deep(.icon) { color: var(--mixed); }
.steps li.failed :deep(.icon) { color: var(--hard-text); }
.progress { grid-column: 2 / 4; height: var(--space-1); border-radius: var(--radius-pill); background: var(--line); overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--mixed); transition: width var(--transition); }
.progress.waiting span { width: 35%; animation: slide var(--bar-slide-s) ease-in-out infinite alternate; }
@keyframes slide { from { transform: translateX(0); } to { transform: translateX(186%); } }
@media (prefers-reduced-motion: reduce) { .progress.waiting span { width: 50%; transform: none; } }
.note {
  margin: var(--space-4) 0 0; padding-top: var(--space-4); border-top: var(--hairline) solid var(--line);
  font-size: var(--fs-sm); color: var(--text-2);
}
.note.error { color: var(--text); }
.buttons { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }

.route-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-3); }
.route-buttons.one { grid-template-columns: 1fr; }
.route-btn {
  display: flex; align-items: center; justify-content: center; gap: var(--space-2);
  min-height: var(--touch-phone); padding: 0 var(--space-1);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; color: var(--text-2); font-size: var(--fs-sm); font-weight: var(--fw-medium);
}
.route-btn.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.sample { display: inline-block; flex: none; width: var(--route-sample-w); height: var(--swatch-h); border-radius: var(--radius-pill); }
.sample.A { background: var(--text); }
.sample.B { background: linear-gradient(to right, var(--text) 40%, transparent 40%, transparent 60%, var(--text) 60%); }
.route { margin-top: var(--space-3); }
.route + .route { padding-top: var(--space-3); border-top: var(--hairline) solid var(--line); }
.route-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); margin: 0; }
.route-line strong { font-weight: var(--fw-semibold); }
.hard { margin-left: auto; font-size: var(--fs-sm); color: var(--text-2); }
.hard.clear { color: var(--easy); }
.bar-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-3); margin-top: var(--space-1); }
.bar-label { font-size: var(--fs-sm); }
.verdict {
  margin: var(--space-3) 0 0; padding: var(--space-3);
  border-radius: var(--radius-btn); background: var(--ground);
}
.window-error { margin: var(--space-3) 0 0; font-size: var(--fs-sm); }

.colour-by { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.by-label { flex: none; font-size: var(--fs-sm); color: var(--text-2); }
.by-buttons { flex: 1; min-width: 0; margin-top: 0; }
.window { margin: 0 0 var(--space-3); }

.sheet {
  border-radius: var(--radius-panel) var(--radius-panel) 0 0; border-bottom: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet .btn { min-height: var(--touch-phone); }
/* Phone (board P3): tighter, so the routes stay in view above the sheet. */
.sheet .route, .sheet .verdict, .sheet .route-buttons { margin-top: var(--space-2); }
.sheet .route + .route { padding-top: var(--space-2); }
.sheet .foot { margin-top: var(--space-2); }
.grip { width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-3); border-radius: var(--radius-pill); background: var(--line); }
</style>
