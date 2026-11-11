<script setup>
// "Which way feels better?" (boards Routes 2–3; phone P3): the progress or the comparison. In the Results
// tab of the sheet on a phone. Before Analyse there is no card: Start, End and Analyse are in the left
// panel (Settings on a phone), and the map hint says what to do.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { formatKm } from '../lib/routes.js'
import { GENERAL_LABEL, hardShare, moneyLine, sensesVerdict } from '../lib/senses.js'
import { useRoutesStore } from '../stores/routes.js'
import { useSensesStore } from '../stores/senses.js'
import AppIcon from './AppIcon.vue'
import RouteBar from './RouteBar.vue'
import SensesFoot from './SensesFoot.vue'
import SensesPanel from './SensesPanel.vue'

const props = defineProps({ phone: Boolean })
const routes = useRoutesStore()
const senses = useSensesStore()
const rating = computed(() => senses.routesProgress)
const ratingShare = computed(() => (rating.value.total ? Math.round((100 * rating.value.done) / rating.value.total) : 0))
const cancel = () => (senses.routesRating ? senses.stopHere('routes') : routes.cancel())
const cancelBtn = ref(null)
const verb = computed(() => (props.phone ? 'Tap' : 'Click'))
const pct = (x) => `${Math.round(x * 100)}%`

// Keyboard: after Analyse, focus goes to Cancel (as in Area).
watch(() => routes.load, async (load) => {
  if (load !== 'loading' || !routes.byKeyboard) return
  await nextTick()
  cancelBtn.value?.focus()
})

onMounted(() => {
  // The card appears when loading starts (no card before Analyse).
  if (routes.byKeyboard && routes.load === 'loading') {
    nextTick(() => cancelBtn.value?.focus())
    return
  }
  // Going back from a stretch: focus returns to its bar section.
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
const loading = computed(() => routes.load === 'loading' || routes.load === 'error' || senses.routesRating)

const bName = (r) => (r.kind === 'easiest' ? 'easiest' : 'alternative')
/** Each layer's own numbers: Thermal's come with the routes, Senses' from the ratings as they are on the stretches. */
const routeHard = (r) => (routes.layer === 'senses' ? hardShare(r.stretches) : r.hard_share)
const hardColour = (r) => (routeHard(r) === 0 ? 'clear' : '')
const verdictText = computed(() => (routes.layer === 'senses' ? sensesVerdict(routes.shown) : routes.verdict))
const coverage = computed(() => {
  const [a, b] = routes.shown
  const each = (key) => {
    if (!b) return `${pct(a[key])} of A`
    return pct(a[key]) === pct(b[key]) ? `${pct(a[key])} of A and B` : `${pct(a[key])} of A and ${pct(b[key])} of B`
  }
  // Each layer speaks only of what it rests on; Overall rests on both.
  if (routes.layer === 'thermal') return `Thermal along ${each('thermal_share')}.`
  if (routes.layer === 'senses') return `Based on photos along ${each('photo_share')}.`
  return `Thermal along ${each('thermal_share')}, photos along ${each('photo_share')}.`
})

// Phone (board P3): the walk (not built yet) starts from the easiest way; the other is the second choice.
const walk = computed(() => {
  const [a, b] = routes.shown
  if (!b) return { main: a.id, other: null }
  return b.kind === 'easiest' ? { main: b.id, other: a.id } : { main: a.id, other: b.id }
})

function onEnter(id) { routes.hoverRoute = id }
function onLeave() { routes.hoverRoute = null }
</script>

<template>
  <section class="card panel" :class="{ sheet: phone }" data-panel="route-card" data-scrollable aria-labelledby="route-title">
    <!-- Loading (board Routes 2): no routes on the map yet. -->
    <template v-if="loading">
      <div class="head">
        <div>
          <h2 id="route-title" class="title">Comparing two ways</h2>
          <p class="meta">Loading the streets between start and end</p>
        </div>
        <button type="button" class="icon-btn" aria-label="Cancel" @click="cancel"><AppIcon name="close" /></button>
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
        <li v-if="routes.layer !== 'senses'" :class="rowState('thermal')">
          <AppIcon :name="rowState('thermal') === 'done' ? 'check' : 'pending'" />
          <span class="label">Thermal</span>
          <span class="detail">{{ routes.thermalWindow.season }}, {{ routes.thermalWindow.time }}</span>
          <span v-if="rowState('thermal') === 'active'" class="progress waiting" aria-hidden="true"><span /></span>
        </li>
        <li v-if="routes.layer === 'senses'" :class="senses.routesRating ? 'active' : 'next'" data-testid="rating-step">
          <AppIcon name="pending" />
          <span class="label" role="status">{{ senses.routesRating ? `Rating ${rating.done} of ${rating.total} places…` : 'Rating the photos' }}</span>
          <span v-if="senses.routesRating" class="progress" aria-hidden="true"><span :style="{ width: `${ratingShare}%` }" /></span>
        </li>
      </ul>
      <p v-if="routes.load === 'error'" class="note error" role="alert">{{ routes.error }}</p>
      <p v-else-if="senses.routesRating" class="note">
        The two ways appear when the rating ends. <span data-testid="senses-cost">{{ moneyLine(senses.runs.routes) }} so far.</span>
        <strong class="general">{{ GENERAL_LABEL }}</strong>
      </p>
      <p v-else-if="routes.hasResult && routes.info" class="note">
        The ways on the map are for {{ routes.info.season }}, {{ routes.info.time }} until the new ones are ready.
      </p>
      <p v-else-if="routes.progress.stage === 'thermal'" class="note">
        Simulating sun, shade and wind along the way. This can take a few minutes.
      </p>
      <p v-else class="note">The two ways appear once the streets between start and end are ready. A new route takes a few minutes.</p>
      <div class="buttons">
        <button v-if="routes.load === 'error'" type="button" class="btn btn-primary" @click="routes.find({ resume: true })">Try again</button>
        <button ref="cancelBtn" type="button" class="btn" @click="cancel">
          {{ routes.load === 'error' ? 'Back' : 'Cancel' }}
        </button>
      </div>
    </template>

    <!-- The comparison (board Routes 3). -->
    <template v-else-if="routes.hasResult">
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
          <span class="hard" :class="hardColour(r)">hard {{ pct(routeHard(r)) }}</span>
        </p>
        <div class="bar-row">
          <span class="muted bar-label">{{ routes.layer === 'senses' ? 'Senses' : 'Thermal' }}</span>
          <RouteBar :route="r" />
        </div>
      </div>
      <p class="verdict">{{ verdictText }}</p>
      <SensesPanel v-if="routes.layer === 'senses'" scope="routes" />
      <SensesFoot v-if="routes.layer === 'senses'" scope="routes" />
      <p v-if="routes.windowError" class="window-error" role="status">{{ routes.windowError }}</p>
      <p class="foot">
        {{ coverage }} {{ verb }} a stretch on the map or a section of a bar to see it. Predictions, not reasons.
      </p>
      <div v-if="phone" class="walk">
        <button type="button" class="btn btn-primary" aria-disabled="true" title="Coming soon">Walk route {{ walk.main }}</button>
        <button v-if="walk.other" type="button" class="btn" aria-disabled="true" title="Coming soon">Walk {{ walk.other }}</button>
      </div>
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

.general { display: block; margin-top: var(--space-2); font-weight: var(--fw-semibold); }
.foot { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }

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

.walk { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-2); margin-top: var(--space-3); }
.walk .btn:only-child { grid-column: 1 / -1; }

/* Inside the phone sheet, which is the panel and does the scrolling. */
.card.sheet { padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.sheet .btn { min-height: var(--touch-phone); }
.sheet .icon-btn { width: var(--touch-phone); height: var(--touch-phone); }
/* Phone (board P3): tighter, so the routes stay in view above the sheet. */
.sheet .route, .sheet .verdict, .sheet .route-buttons { margin-top: var(--space-2); }
.sheet .route + .route { padding-top: var(--space-2); }
.sheet .foot { margin-top: var(--space-2); }
</style>
