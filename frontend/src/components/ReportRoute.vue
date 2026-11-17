<script setup>
// The report's route comparison (board 8b): a light map of both routes (A solid, B dashed, Start a ring, End a dot),
// the legend on the map with the layer and its season and time first, one row per route (line sample, km and minutes,
// its bar stretch by stretch, the hard and mixed stretches, % hard), and the verdict with what it rests on, as on the route card.
import { computed, onMounted, ref } from 'vue'
import { keyTitle } from '../lib/legend.js'
import { routeCoverage, routeRow, routeVerdict, stretchCounts } from '../lib/report.js'
import { formatKm } from '../lib/routes.js'
import { mapSize, routesSnapshot } from '../map/print.js'
import { useReportStore } from '../stores/report.js'
import { useRoutesStore } from '../stores/routes.js'

const routes = useRoutesStore()
const report = useReportStore()
const layer = routes.layer
const shown = computed(() => routes.shown)
const rows = computed(() => shown.value.map((r) => ({ ...routeRow(layer, r), km: formatKm(r.length_m), minutes: r.minutes })))
const pct = (x) => `${Math.round(x * 100)}%`
/** What the routes' colours and the bars show, as the app's legend names it: "Overall comfort · summer, 15:00". */
const key = computed(() => keyTitle(layer, routes.info))
const verdict = computed(() => routeVerdict(layer, shown.value, routes.verdict))
const coverage = computed(() => routeCoverage(layer, shown.value))
const LEGEND = [{ id: 'easy', label: 'Easy' }, { id: 'mixed', label: 'Mixed' }, { id: 'hard', label: 'Hard' },
  { id: 'none', label: layer === 'thermal' ? 'No value' : layer === 'overall' ? 'No data' : 'No photo' }]
/** A section of the bar, with a gap only where the state changes (as on the route card). */
const gapBefore = (r, i) => i > 0 && r.sections[i - 1].state !== r.sections[i].state

const map = ref(null)
const drawn = ref(false)
onMounted(async () => {
  report.pending++
  try {
    map.value = await routesSnapshot({ ...mapSize('--report-route-map-h'), routes: shown.value, start: routes.start, end: routes.end })
  } finally {
    drawn.value = true
    report.pending = Math.max(0, report.pending - 1)
  }
})
</script>

<template>
  <section class="route" data-section="route" aria-labelledby="report-route-title">
    <h2 id="report-route-title">Route comparison</h2>
    <div v-if="map || !drawn" class="map" data-testid="report-route-map">
      <img v-if="map" :src="map" alt="Map of the two routes: A solid, B dashed, coloured stretch by stretch." />
      <p v-else class="muted waiting">Drawing the map…</p>
      <!-- The legend on the map, as on the area's (Elena, 2026-11-17): the layer first. -->
      <p class="legend" aria-hidden="true">
        <strong data-testid="report-route-key">{{ key.name }}{{ key.when ? ` · ${key.when}` : '' }}</strong>
        <span v-for="l in LEGEND" :key="l.id" class="key"><i :class="['sw', l.id]" />{{ l.label }}</span>
        <span class="key"><i class="pin start" />Start</span>
        <span class="key"><i class="pin end" />End</span>
      </p>
    </div>

    <h3 class="label rows-title">Stretches by {{ key.name.toLowerCase() }}</h3>

    <ul class="rows" data-testid="report-routes">
      <li v-for="r in rows" :key="r.id" :data-route="r.id">
        <svg class="sample" viewBox="0 0 24 8" aria-hidden="true"><line :class="r.id" x1="1" y1="4" x2="23" y2="4" /></svg>
        <span class="name"><strong>{{ r.id }}</strong> {{ r.name }}</span>
        <span class="len">{{ r.km }}, {{ r.minutes }} min</span>
        <span class="bar" role="img" :aria-label="`Route ${r.id}: ${stretchCounts(r)}, ${pct(r.hard)} hard`">
          <span v-for="(s, i) in r.sections" :key="s.key" :class="['sec', s.state, { gap: gapBefore(r, i) }]" :style="{ flexGrow: s.length }" />
        </span>
        <span class="share"><strong>{{ pct(r.hard) }}</strong> hard</span>
        <span class="stretches muted">{{ stretchCounts(r) }}</span>
      </li>
    </ul>
    <div class="verdict">
      <p><strong>{{ verdict }}</strong></p>
      <p>{{ coverage }}</p>
    </div>
  </section>
</template>

<style scoped>
.route { display: flex; flex-direction: column; gap: var(--space-3); }
.map { position: relative; height: var(--report-route-map-h); border-radius: var(--radius-btn); overflow: hidden; border: var(--hairline) solid var(--report-line); background: var(--report-soft); }
.map img { display: block; width: 100%; height: 100%; object-fit: cover; }
.waiting { padding: var(--space-4); }
.rows li {
  display: grid; grid-template-columns: var(--report-icon) var(--report-route-name-w) var(--report-route-len-w) 1fr var(--report-route-share-w); grid-template-areas: "s n l b h" ". . . c .";
  align-items: center; column-gap: var(--space-3); padding: var(--space-1) 0;
}
.sample { grid-area: s; width: var(--report-icon); height: var(--space-2); overflow: visible; }
.sample line { stroke: var(--report-ink); stroke-width: var(--report-sample-line); }
.sample line.B { stroke-dasharray: 4 3; }
.name { grid-area: n; }
.len { grid-area: l; color: var(--report-ink-2); }
.bar { grid-area: b; display: flex; height: var(--report-bar-h); border-radius: var(--radius-pill); overflow: hidden; }
.sec { min-width: var(--hairline); background: var(--c); }
.sec.gap { margin-left: var(--report-gap-bar); }
.easy { --c: var(--report-easy); }
.mixed { --c: var(--report-mixed); }
.hard { --c: var(--report-hard); }
.none { --c: var(--report-none); }
.share { grid-area: h; text-align: right; }
.stretches { grid-area: c; font-size: var(--report-fs-sm); }
.legend {
  position: absolute; left: var(--space-3); bottom: var(--space-3); display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-1) var(--space-3); border-radius: var(--radius-chip); background: var(--report-bg); font-size: var(--report-fs-sm);
}
.rows-title { margin-bottom: calc(-1 * var(--space-2)); }
.key { display: inline-flex; align-items: center; gap: var(--space-2); }
.sw { display: inline-block; width: var(--report-swatch-w); height: var(--report-swatch-h); border-radius: var(--radius-pill); background: var(--c); }
.pin { display: inline-block; width: var(--space-3); height: var(--space-3); border-radius: 50%; border: var(--report-pin-edge) solid var(--report-ink); }
.pin.start { background: var(--report-bg); }
.pin.end { background: var(--report-ink); }
.verdict { padding: var(--space-3) var(--space-4); border-radius: var(--radius-btn); background: var(--report-soft); }
</style>
