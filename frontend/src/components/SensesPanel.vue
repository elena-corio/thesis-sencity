<script setup>
// The background rating and, once it has ended, what comes of it: progress and running cost, the question above the cap,
// and for an area the most comfortable places. On a route the card itself shows the result (board Routes 3); the label
// and status line close either card (SensesFoot). Clicking a place opens its detail from the ratings already here: no new call.
import { computed } from 'vue'
import { typeLabel } from '../lib/place.js'
import { comfortLabel, levelWord, moneyLine } from '../lib/senses.js'
import { useAreaStore } from '../stores/area.js'
import { useSensesStore } from '../stores/senses.js'
import AppIcon from './AppIcon.vue'
import MarkerPin from './MarkerPin.vue'

const props = defineProps({ scope: { type: String, required: true } })
const senses = useSensesStore()
const area = useAreaStore()

const run = computed(() => senses.runs[props.scope])
const progress = computed(() => (props.scope === 'area' ? senses.areaProgress : senses.routesProgress))
const share = computed(() => (progress.value.total ? Math.round((100 * progress.value.done) / progress.value.total) : 0))
// A route's result is on its card, so here it has only the rating's own messages.
const hasContent = computed(() => (props.scope === 'area'
  ? progress.value.total > 0 || run.value.status === 'error'
  : ['rating', 'paused', 'stopped', 'error'].includes(run.value.status) || progress.value.failed > 0))
const placeNoun = (n) => (n === 1 ? 'place' : 'places')

// Area: the numbered pins on the map, with the same numbers here (as the Thermal suggestions).
const rows = computed(() => (props.scope === 'area' ? area.suggestions : []).map((m) => ({
  m, id: m.f.properties.id, name: m.f.properties.name, type: typeLabel(m.f.properties, m.f.geometry.type),
  place: senses.placeFor(m.f.properties.photos), seen: area.seenIds.has(m.f.properties.id),
})))
const rowLabel = (r) => `${r.m.n}. ${r.name}, ${r.type}, ${comfortLabel(r.place)}, ${levelWord(r.m.level)}${r.seen ? ', seen' : ''}`

const rated = computed(() => run.value.status !== 'idle' && run.value.status !== 'rating')
</script>

<template>
  <section v-if="hasContent" class="senses" data-testid="senses-panel" :aria-busy="run.status === 'rating'">
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

    <div v-else-if="run.status === 'stopped'" class="ask" role="group" aria-label="Rating stopped" data-testid="senses-stopped">
      <p><strong>Rating stopped at {{ progress.done }} of {{ progress.total }} places.</strong></p>
      <p class="muted small">What is rated stays on the map.</p>
      <div class="buttons"><button type="button" class="btn" @click="senses.continueRating(scope)">Continue</button></div>
    </div>

    <div v-else-if="run.status === 'error'" class="failed" role="alert" data-testid="senses-run-error">
      <p class="fail-text"><strong>Could not finish rating.</strong> {{ run.error }}</p>
      <p class="muted small">What is rated stays on the map.</p>
      <button type="button" class="btn btn-primary" @click="senses.retry(scope)">Retry</button>
    </div>

    <div v-if="progress.failed && run.status !== 'rating'" class="failed" data-testid="senses-failed">
      <p class="fail-text">{{ progress.failed }} {{ placeNoun(progress.failed) }} could not be rated.</p>
      <button v-if="run.status !== 'error'" type="button" class="btn" @click="senses.retry(scope)">Retry</button>
    </div>

    <template v-if="rated && scope === 'area'">
      <section class="list" data-testid="senses-best">
        <h3>Most comfortable nearby</h3>
        <ol v-if="rows.length">
          <li v-for="r in rows" :key="r.id">
            <button type="button" class="row" :aria-label="rowLabel(r)" @click="area.selectMarker(r.m, $event.detail === 0)">
              <MarkerPin :n="r.m.n" :level="r.m.level" />
              <span class="text">
                <span class="name" lang="de">{{ r.name }}</span>
                <span class="muted small">{{ r.type }} · {{ comfortLabel(r.place) }}</span>
              </span>
              <span :class="['state', 'side', r.m.level]">{{ levelWord(r.m.level) }}</span>
              <AppIcon v-if="r.seen" name="check" class="seen" />
            </button>
          </li>
        </ol>
        <p v-else class="muted small">No place here is rated comfortable.</p>
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
.fail-text { overflow-wrap: anywhere; }
.failed .btn { margin-top: var(--space-2); }
.buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.failed:not(:first-child) { margin-top: var(--space-3); }
.list { margin-top: var(--space-4); }
.list h3 { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.list ol { list-style: none; margin: var(--space-1) 0 0; padding: 0; }
.row {
  display: flex; gap: var(--space-3); align-items: flex-start; width: 100%; min-height: var(--touch-phone);
  padding: var(--space-2) 0; border: 0; background: transparent; color: var(--text); text-align: left;
}
.row:hover .name { text-decoration: underline; }
.text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.side { flex: none; font-size: var(--fs-sm); }
.side.easy { color: var(--easy); }
.side.mixed { color: var(--mixed); }
.seen { color: var(--text-2); }
.name { font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.state.hard { color: var(--hard-text); }
</style>
