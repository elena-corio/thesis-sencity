<script setup>
// "How close SenCity is to you" (Elena, 2026-11-16): from your own ratings that had a prediction on screen
// (lib/myRatings.js), no model call. Three numbers (how many, the average gap |prediction − you|, the share within 1
// point), then the gap over time by groups of 4 ratings (the study's rounds): one line for personal (V2) and one for
// general (V0) predictions when both exist. Lower is closer. A hidden table says the same to screen readers.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { GROUP, allRatings, closeness } from '../lib/myRatings.js'

const entries = ref(allRatings())
const refresh = () => { entries.value = allRatings() }
onMounted(() => window.addEventListener('storage', refresh))
onBeforeUnmount(() => window.removeEventListener('storage', refresh))
defineExpose({ refresh })

const c = computed(() => closeness(entries.value))
const fmt = (x) => x.toFixed(1)
const pct = (x) => `${Math.round(x * 100)}%`

// The chart: x = group of 4 (1–4, 5–8, …), y = mean gap 0–4 points (lower is closer).
// Drawn at its own size (never scaled up, so its text stays the card's size); narrower screens scale it down.
const W = 600
const H = 200
const PAD = { l: 28, r: 72, t: 16, b: 26 }
const Y_MAX = 4
const SERIES = [
  { id: 'V2', label: 'personal', cls: 'v2' },
  { id: 'V0', label: 'general', cls: 'v0' },
]
const lines = computed(() => SERIES.filter((s) => c.value.lines[s.id]).map((s) => ({ ...s, points: c.value.lines[s.id] })))
const groups = computed(() => Math.max(1, ...lines.value.map((l) => l.points.length)))
const x = (i) => PAD.l + (groups.value === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (groups.value - 1))
const y = (v) => PAD.t + ((Y_MAX - Math.min(Y_MAX, v)) / Y_MAX) * (H - PAD.t - PAD.b)
const path = (pts) => pts.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
const groupLabel = (i) => `${i * GROUP + 1}–${(i + 1) * GROUP}`
const hover = ref(null) // { s, i }
const tip = computed(() => {
  if (!hover.value) return null
  const { s, i } = hover.value
  const v = s.points[i]
  return { text: `Ratings ${groupLabel(i)} (${s.label}): off by ${fmt(v)} on average`, left: `${(x(i) / W) * 100}%`, top: `${(y(v) / H) * 100}%` }
})
</script>

<template>
  <section class="how-close" aria-labelledby="how-close-title" data-testid="how-close">
    <h3 id="how-close-title">How close SenCity is to you</h3>
    <p v-if="!c.enough" class="muted" data-testid="how-close-empty">Rate a few places to see how close SenCity is to you.</p>
    <template v-else>
      <div class="tiles">
        <p class="tile"><strong data-testid="how-close-n">{{ c.n }}</strong><span>ratings</span></p>
        <p class="tile"><strong data-testid="how-close-gap">{{ fmt(c.gap) }}</strong><span>points off on average</span></p>
        <p class="tile"><strong data-testid="how-close-within">{{ pct(c.within1) }}</strong><span>within 1 point</span></p>
      </div>
      <div v-if="lines.length" class="chart" @mouseleave="hover = null">
        <p v-if="lines.length > 1" class="legend">
          <span v-for="s in lines" :key="s.id"><svg viewBox="0 0 24 8" aria-hidden="true"><line :class="s.cls" x1="1" y1="4" x2="23" y2="4" /></svg>{{ s.label }}</span>
        </p>
        <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-labelledby="how-close-title" data-testid="how-close-chart">
          <g class="grid" aria-hidden="true">
            <line v-for="v in [0, 1, 2, 3, 4]" :key="v" :x1="PAD.l" :x2="W - PAD.r" :y1="y(v)" :y2="y(v)" />
            <text v-for="v in [0, 2, 4]" :key="`t${v}`" :x="PAD.l - 6" :y="y(v) + 4" text-anchor="end">{{ v }}</text>
            <text v-for="(_, i) in Array(groups)" :key="`g${i}`" :x="x(i)" :y="H - 6" text-anchor="middle">{{ groupLabel(i) }}</text>
          </g>
          <g v-for="s in lines" :key="s.id">
            <path :class="['line', s.cls]" :d="path(s.points)" />
            <circle v-for="(v, i) in s.points" :key="i" :class="['dot', s.cls]" :cx="x(i)" :cy="y(v)" r="4" />
            <!-- A line that reaches the last group is named at its end; one that stops earlier, just above its last point, clear of the other line. -->
            <text :class="['direct', s.cls]" :x="x(s.points.length - 1) + 8" :y="y(s.points.at(-1)) + (s.points.length < groups ? -10 : 4)">{{ s.label }}</text>
            <circle v-for="(v, i) in s.points" :key="`h${i}`" class="hit" :cx="x(i)" :cy="y(v)" r="12"
                    @mouseenter="hover = { s, i }" />
          </g>
        </svg>
        <p v-if="tip" class="tip" :style="{ left: tip.left, top: tip.top }" role="presentation">{{ tip.text }}</p>
        <p class="axis-note">Points off, by groups of {{ GROUP }} ratings, oldest first. Lower is closer.</p>
        <table class="visually-hidden">
          <caption>How far SenCity's predictions were from your ratings, by groups of {{ GROUP }}</caption>
          <thead><tr><th scope="col">Ratings</th><th v-for="s in lines" :key="s.id" scope="col">{{ s.label }}</th></tr></thead>
          <tbody>
            <tr v-for="(_, i) in Array(groups)" :key="i">
              <th scope="row">{{ groupLabel(i) }}</th>
              <td v-for="s in lines" :key="s.id">{{ s.points[i] != null ? fmt(s.points[i]) : '–' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">Only ratings with a prediction on screen count. Kept on this device.</p>
    </template>
  </section>
</template>

<style scoped>
p, h3 { margin: 0; }
.how-close { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-3); border-top: var(--hairline) solid var(--line); }
h3 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }
.small { font-size: var(--fs-xs); }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.tile { display: flex; flex-direction: column; gap: var(--space-1); }
.tile strong { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile span { font-size: var(--fs-xs); color: var(--text-2); }
.chart { position: relative; }
.chart > svg { width: 100%; max-width: var(--chart-w); height: auto; overflow: visible; display: block; }
.legend { display: flex; gap: var(--space-4); font-size: var(--fs-xs); color: var(--text-2); margin-bottom: var(--space-1); }
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.legend svg { width: var(--space-5); height: var(--space-2); }
.grid line { stroke: var(--line); stroke-width: var(--hairline); }
.grid text { fill: var(--text-muted); font-size: var(--fs-2xs); font-variant-numeric: tabular-nums; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.legend line { stroke-width: 2; }
.v2 { stroke: var(--chart-v2); }
.v0 { stroke: var(--chart-v0); stroke-dasharray: 5 4; }
.dot { stroke: var(--panel); stroke-width: 2; stroke-dasharray: none; }
.dot.v2 { fill: var(--chart-v2); }
.dot.v0 { fill: var(--chart-v0); }
.direct { fill: var(--text-2); stroke: none; font-size: var(--fs-2xs); }
.hit { fill: transparent; stroke: none; cursor: default; }
.tip {
  position: absolute; transform: translate(-50%, calc(-100% - var(--space-3))); pointer-events: none; z-index: 1;
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-chip); background: var(--panel);
  border: var(--hairline) solid var(--line); box-shadow: var(--shadow); font-size: var(--fs-xs); white-space: nowrap;
}
.axis-note { font-size: var(--fs-xs); color: var(--text-muted); margin-top: var(--space-1); }
</style>
