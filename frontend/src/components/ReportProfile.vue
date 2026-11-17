<script setup>
// The report's profile (board 8, "How you sense the city"): the radar as on the Profile view (1–5 rings, the eight
// senses), drawn as SVG so it prints sharp, with "what bothers you" dashed so it reads in grey; your own words; the
// overall comfort (A11), what is strongest for you, and the temperature that feels comfortable (the profile's bar,
// without its handles). From the answers on this device only.
import { computed } from 'vue'
import config from '../config.js'
import { radarShape, senseScores, strongest } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import { comfortLines, limitText, standardLimits, thermalBar } from '../lib/thermal.js'
import { useProfileStore } from '../stores/profile.js'
import SenseIcon from './SenseIcon.vue'

const store = useProfileStore()
const lang = config.language
const survey = computed(() => store.survey)
const p = computed(() => store.profile)
const question = (code) => survey.value.questions.find((q) => q.code === code)

const MAX = 5
const R = 100
const ICON_R = 124
const scores = computed(() => (survey.value ? senseScores(survey.value, p.value.answers) : []))
const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / scores.value.length
const at = (i, r) => [r * Math.cos(angle(i)), r * Math.sin(angle(i))]
const xy = (i, v) => at(i, (v / MAX) * R).map((n) => n.toFixed(2)).join(' ')
const good = computed(() => radarShape(scores.value, 'good', xy))
const bothers = computed(() => radarShape(scores.value, 'bothers', xy))
const place = (i) => {
  const [x, y] = at(i, ICON_R)
  return { left: `${((x + 150) / 300) * 100}%`, top: `${((y + 150) / 300) * 100}%` }
}
const radarLabel = computed(() => scores.value.map((s) => `${senseName(s.sense)}: ${s.bothers == null ? 'no answers' : `bothers ${s.bothers}, feels good ${s.good}`}`).join('; '))

const a11 = computed(() => question('A11'))
const words = (code) => question(code).scale[lang]
const top = computed(() => strongest(survey.value, p.value.answers))
const topText = (kind) => top.value.filter((t) => t.kind === kind).map((t) => `${t.row[lang]} (${t.score} · ${words('A12')[t.score - 1].toLowerCase()})`).join(', ')

// The temperature that feels comfortable: the profile's bar in the print colours, with its limits written under it.
const limits = computed(() => store.limits ?? standardLimits())
const bar = computed(() => thermalBar(limits.value, 'both'))
const fill = computed(() => `linear-gradient(to right, ${bar.value.stops.map((s) => `var(--report-${s.state}) ${s.at}%`).join(', ')})`)
const lines = computed(() => comfortLines(limits.value))
</script>

<template>
  <section class="profile" data-section="profile" aria-labelledby="report-profile-title">
    <p v-if="!survey" class="muted" role="status">Loading your profile…</p>
    <template v-else>
      <figure class="radar" role="img" :aria-label="`Your senses, 1 to 5. ${radarLabel}`" data-testid="report-radar">
        <svg viewBox="-150 -150 300 300" aria-hidden="true">
          <circle v-for="r in [1, 2, 3, 4, 5]" :key="r" class="ring" :class="{ mid: r === 3 }" cx="0" cy="0" :r="(r / MAX) * R" />
          <line v-for="(s, i) in scores" :key="s.sense" class="axis" x1="0" y1="0" :x2="at(i, R)[0]" :y2="at(i, R)[1]" />
          <text v-for="r in [1, 3, 5]" :key="`t${r}`" class="ring-label" x="4" :y="-(r / MAX) * R - 3">{{ r }}</text>
          <path class="good" :class="{ filled: good.filled }" :d="good.d" />
          <path class="bothers" :class="{ filled: bothers.filled }" :d="bothers.d" />
        </svg>
        <span v-for="(s, i) in scores" :key="s.sense" class="icon" :class="{ gap: s.bothers == null }" :style="place(i)">
          <SenseIcon :sense="s.sense" />
        </span>
      </figure>

      <div class="text">
        <h2 id="report-profile-title">How you sense the city</h2>
        <p class="legend">
          <span><svg viewBox="0 0 24 8" aria-hidden="true"><line class="bothers" x1="1" y1="4" x2="23" y2="4" /></svg>What bothers you</span>
          <span><svg viewBox="0 0 24 8" aria-hidden="true"><line class="good" x1="1" y1="4" x2="23" y2="4" /></svg>What feels good</span>
        </p>
        <blockquote v-if="p.answers.A16" class="words" data-testid="report-words">“{{ p.answers.A16 }}”</blockquote>
        <p class="line"><strong>Overall sensory comfort: {{ p.answers.A11 }} of 5</strong>
          <span class="muted"> (1 {{ a11.labels['1'][lang].toLowerCase() }}, 5 {{ a11.labels['5'][lang].toLowerCase() }})</span></p>
        <p v-if="top.length" class="line small">
          <template v-if="topText('bothers')">Bothers you most: {{ topText('bothers') }}. </template>
          <template v-if="topText('good')">Feels good: {{ topText('good') }}.</template>
        </p>

        <div class="comfort" data-testid="report-comfort">
          <p class="line"><strong>Temperature that feels comfortable to you</strong> <span class="muted">(feels like, °C)</span></p>
          <div class="bar" :style="{ background: fill }" />
          <div class="ticks" aria-hidden="true">
            <span v-for="t in bar.ticks" :key="t.at" :style="{ left: `${t.at}%` }">{{ limitText(t.value) }}</span>
          </div>
          <p class="muted small">{{ lines[0] }} {{ lines[1] }}</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profile { display: grid; grid-template-columns: var(--report-radar) 1fr; gap: var(--report-gap); align-items: start; }
.radar { position: relative; width: var(--report-radar); aspect-ratio: 1; }
.radar svg { width: 100%; height: 100%; overflow: visible; }
.ring, .axis { fill: none; stroke: var(--report-line); stroke-width: var(--radar-ring); }
.ring.mid { stroke: var(--report-muted); stroke-dasharray: 2 3; }
.ring-label { fill: var(--report-muted); font-size: var(--report-fs-xs); }
.good, .bothers { fill: none; stroke-width: var(--report-radar-line); stroke-linejoin: round; stroke-linecap: round; }
.good { stroke: var(--report-good); }
.bothers { stroke: var(--report-hard); stroke-dasharray: 5 4; }
.good.filled { fill: var(--report-good); fill-opacity: var(--radar-fill-opacity); }
.bothers.filled { fill: var(--report-hard); fill-opacity: var(--radar-fill-opacity); }
.icon { position: absolute; transform: translate(-50%, -50%); color: var(--report-ink-2); display: grid; }
.icon :deep(.sense-icon) { width: var(--report-icon); height: var(--report-icon); }
.icon.gap { opacity: var(--inactive-opacity); }
.text { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.small { font-size: var(--report-fs-sm); }
.legend { display: flex; gap: var(--space-5); color: var(--report-ink-2); }
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.legend svg { width: var(--report-icon); height: var(--space-2); overflow: visible; }
.words { margin: var(--space-1) 0; padding-left: var(--space-3); border-left: var(--report-rule) solid var(--report-line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--report-fs-lead); }
.line { color: var(--report-ink); }
.comfort { margin-top: var(--space-1); }
.bar { height: var(--report-bar-h); border-radius: var(--radius-pill); margin-top: var(--space-1); }
.ticks { position: relative; height: 1.9em; font-size: var(--report-fs-xs); color: var(--report-muted); }
.ticks span { position: absolute; top: var(--space-1); transform: translateX(-50%); white-space: nowrap; }
.ticks span:first-child { transform: none; }
.ticks span:last-child { transform: translateX(-100%); }
</style>
