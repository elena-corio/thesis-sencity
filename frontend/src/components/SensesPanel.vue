<script setup>
// The background rating and what it recommends, updated as ratings arrive: progress and running cost, the question
// above the cap, then the most comfortable places and the places to avoid (an area), or each way's overall comfort
// and its hardest stretch (routes). Clicking a place opens its detail from the ratings already here: no new call.
import { computed } from 'vue'
import { GENERAL_LABEL, comfortLabel, elementLabel, levelWord, moneyLine, recommendations, routeSummary, runStatusLine } from '../lib/senses.js'
import { useAreaStore } from '../stores/area.js'
import { useRoutesStore } from '../stores/routes.js'
import { useSensesStore } from '../stores/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({ scope: { type: String, required: true } })
const senses = useSensesStore()
const area = useAreaStore()
const routes = useRoutesStore()

const run = computed(() => senses.runs[props.scope])
const progress = computed(() => (props.scope === 'area' ? senses.areaProgress : senses.routesProgress))
const share = computed(() => (progress.value.total ? Math.round((100 * progress.value.done) / progress.value.total) : 0))
const hasPlaces = computed(() => progress.value.total > 0)
const placeNoun = (n) => (n === 1 ? 'place' : 'places')

// Area: from the places on the map (the Places filter applies, as for the suggestions).
const placeOf = (f) => senses.placeFor(f.properties.photos)
const picks = computed(() => (props.scope === 'area'
  ? recommendations(area.visibleSegments?.features.filter((f) => f.properties.photos?.length) ?? [], placeOf, area.analysed)
  : { best: [], avoid: [] }))
function open(item, event) {
  area.byKeyboard = event.detail === 0
  area.select(item.f.properties.id, item.mid)
}

// Routes: each way, rated along what is known so far.
const stretchPlace = (s) => senses.placeFor(routes.segments.get(s.segmentId)?.properties.photos)
const summaries = computed(() => (props.scope === 'routes'
  ? routes.shown.map((r) => ({ id: r.id, summary: routeSummary(r.stretches, stretchPlace) }))
  : []))
const nameOf = (stretch) => routes.segments.get(stretch.segmentId)?.properties.name ?? 'Street'
const bothers = (place) => place.mainBothers.map((e) => ({ code: e.code, icon: e.sense, ...elementLabel(e) }))
const rated = computed(() => run.value.status !== 'idle' && run.value.status !== 'rating')
const emptyBest = computed(() => (run.value.status === 'rating' ? 'None rated as comfortable yet.' : 'No place here is rated comfortable.'))
const emptyAvoid = computed(() => (run.value.status === 'rating' ? 'None rated as hard so far.' : 'No place here is rated hard.'))
</script>

<template>
  <section v-if="hasPlaces || run.status === 'error'" class="senses" data-testid="senses-panel" :aria-busy="run.status === 'rating'">
    <div v-if="run.status === 'rating'" class="progress" role="status">
      <p class="progress-line"><strong>Rating {{ progress.done }} of {{ progress.total }} places…</strong></p>
      <div class="bar" aria-hidden="true"><span :style="{ width: `${share}%` }" /></div>
      <p class="muted small" data-testid="senses-cost">{{ moneyLine(run) }} so far</p>
    </div>

    <div v-else-if="run.status === 'paused'" class="ask" role="group" aria-label="More photos to rate" data-testid="senses-ask">
      <p><strong>{{ run.remaining }} more {{ run.remaining === 1 ? 'photo' : 'photos' }} to rate.</strong></p>
      <p class="muted small">
        About ${{ run.estimateUsd.toFixed(2) }} for the model, and about ${{ run.estimateStreetviewUsd.toFixed(2) }} for the
        Street View images at list price. The nearest places are rated already.
      </p>
      <div class="buttons">
        <button type="button" class="btn btn-primary" @click="senses.continueRating(scope)">Continue</button>
        <button type="button" class="btn" @click="senses.stopHere(scope)">Stop here</button>
      </div>
    </div>

    <div v-else-if="run.status === 'error'" class="failed" role="alert" data-testid="senses-run-error">
      <p class="fail-text"><strong>Could not finish rating.</strong> {{ run.error }}</p>
      <p class="muted small">What is rated stays on the map.</p>
      <button type="button" class="btn btn-primary" @click="senses.retry(scope)">Retry</button>
    </div>

    <p class="general">{{ GENERAL_LABEL }}</p>
    <p class="muted small">Predictions, not reasons.</p>
    <p v-if="rated && run.model" class="status" data-testid="senses-status">{{ runStatusLine(run, progress.rated) }}</p>

    <div v-if="progress.failed && run.status !== 'rating'" class="failed" data-testid="senses-failed">
      <p class="fail-text">{{ progress.failed }} {{ placeNoun(progress.failed) }} could not be rated.</p>
      <button v-if="run.status !== 'error'" type="button" class="btn" @click="senses.retry(scope)">Retry</button>
    </div>

    <template v-if="scope === 'area'">
      <section class="list" data-testid="senses-best">
        <h3>Most comfortable nearby</h3>
        <ol v-if="picks.best.length">
          <li v-for="item in picks.best" :key="item.f.properties.id">
            <button type="button" class="row" @click="open(item, $event)">
              <span class="dot" :style="{ background: `var(--${item.place.level})` }" />
              <span class="text">
                <span class="name" lang="de">{{ item.f.properties.name }}</span>
                <span class="muted small"><span :class="['state', item.place.level]">{{ levelWord(item.place.level) }}</span> · {{ comfortLabel(item.place) }}</span>
              </span>
            </button>
          </li>
        </ol>
        <p v-else class="muted small">{{ emptyBest }}</p>
      </section>

      <section class="list" data-testid="senses-avoid">
        <h3>Places to avoid</h3>
        <ol v-if="picks.avoid.length">
          <li v-for="item in picks.avoid" :key="item.f.properties.id">
            <button type="button" class="row" @click="open(item, $event)">
              <span class="dot" :style="{ background: `var(--${item.place.level})` }" />
              <span class="text">
                <span class="name" lang="de">{{ item.f.properties.name }}</span>
                <span class="muted small"><span :class="['state', item.place.level]">{{ levelWord(item.place.level) }}</span> · {{ comfortLabel(item.place) }}</span>
                <span v-for="e in bothers(item.place)" :key="e.code" class="bother">
                  <SenseIcon :sense="e.icon" :label="e.sense" />{{ e.text }}
                </span>
              </span>
            </button>
          </li>
        </ol>
        <p v-else class="muted small">{{ emptyAvoid }}</p>
      </section>
    </template>

    <template v-else>
      <section v-for="r in summaries" :key="r.id" class="list" :data-testid="`senses-route-${r.id}`">
        <h3>Route {{ r.id }}</h3>
        <template v-if="r.summary">
          <p class="overall">
            <span class="dot" :style="{ background: `var(--${r.summary.level})` }" />
            <span>Overall <span :class="['state', r.summary.level]">{{ levelWord(r.summary.level) }}</span> · {{ comfortLabel(r.summary) }}</span>
          </p>
          <p class="muted small">Rated along {{ Math.round(r.summary.share * 100) }}% of the way.</p>
          <button type="button" class="row" @click="routes.selectStretch(r.summary.hardest.stretch.key, undefined, $event.detail === 0)">
            <span class="dot" :style="{ background: `var(--${r.summary.hardest.place.level})` }" />
            <span class="text">
              <span class="muted small">Hardest stretch</span>
              <span class="name" lang="de">{{ nameOf(r.summary.hardest.stretch) }}</span>
              <span class="muted small">{{ comfortLabel(r.summary.hardest.place) }}</span>
              <span v-for="e in bothers(r.summary.hardest.place)" :key="e.code" class="bother">
                <SenseIcon :sense="e.icon" :label="e.sense" />{{ e.text }}
              </span>
            </span>
          </button>
        </template>
        <p v-else class="muted small">Not rated yet.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
p { margin: 0; }
.senses { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.muted { color: var(--text-2); }
.small { font-size: var(--fs-sm); }
.bar { height: var(--bar-h); margin: var(--space-2) 0; border-radius: var(--bar-radius); background: var(--no-photo); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--text-2); transition: width var(--transition); }
.ask, .failed { margin-top: var(--space-1); padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--warning); border-radius: var(--radius-btn); }
.failed + .general, .ask + .general { margin-top: var(--space-3); }
.fail-text { overflow-wrap: anywhere; }
.failed .btn { margin-top: var(--space-2); }
.buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.general { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.progress + .general { margin-top: var(--space-3); }
.failed:not(:first-child) { margin-top: var(--space-3); }
.list { margin-top: var(--space-4); }
.list h3 { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.list ol { list-style: none; margin: var(--space-1) 0 0; padding: 0; }
.row {
  display: flex; gap: var(--space-3); align-items: flex-start; width: 100%; min-height: var(--touch-phone);
  padding: var(--space-2) 0; border: 0; background: transparent; color: var(--text); text-align: left;
}
.row:hover .name { text-decoration: underline; }
.dot { flex: none; width: var(--space-3); height: var(--space-3); margin-top: var(--space-1); border-radius: 50%; border: var(--hairline) solid var(--marker-edge); }
.text { display: flex; flex-direction: column; min-width: 0; }
.name { font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.state.hard { color: var(--hard-text); }
.bother { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1); font-size: var(--fs-sm); }
.bother .sense-icon { color: var(--hard-text); }
.overall { display: flex; align-items: flex-start; gap: var(--space-3); margin-top: var(--space-2); }
.status { margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
</style>
