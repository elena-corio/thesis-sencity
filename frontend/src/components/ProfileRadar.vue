<script setup>
// The radar of your profile (Elena, 2026-11-15): one axis per sense, in the onboarding's order, with its icon; per
// sense the strongest pleasant and unpleasant element, 0–2 (lib/profile.js senseScores). Pleasant in blue, solid;
// unpleasant in pink, dashed; a sense with no answers is a gap. A11 as a number in the centre, A16 as text below.
// Tapping an axis lists its elements with their values; "Show as a list" says it all as text. Computed from the stored
// answers only, so it changes as soon as an answer is edited; no model call.
import { computed, ref } from 'vue'
import config from '../config.js'
import { senseScores } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({ survey: { type: Object, required: true }, answers: { type: Object, required: true } })
const emit = defineEmits(['edit-words'])
const lang = config.language
const scores = computed(() => senseScores(props.survey, props.answers))
const scale = computed(() => props.survey.questions.find((q) => q.code === 'A12').scale[lang])
const a11 = computed(() => props.survey.questions.find((q) => q.code === 'A11'))
const selected = ref(null)
const picked = computed(() => scores.value.find((s) => s.sense === selected.value) ?? null)

const MAX = 2 // the radius: values 0–2
const R = 100 // the outer ring, in view box units
const ICON_R = 126
const N = computed(() => scores.value.length)
const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N.value
const at = (i, r) => [r * Math.cos(angle(i)), r * Math.sin(angle(i))]
const xy = (i, v) => at(i, (v / MAX) * R).map((n) => n.toFixed(2)).join(' ')

/** A polygon as a path: a line between two neighbouring senses that both have answers; a sense without is a gap.
 *  Filled only when no sense is missing. */
function shape(key) {
  const s = scores.value
  const whole = s.every((x) => x[key] != null)
  if (whole) return { d: `M ${s.map((x, i) => xy(i, x[key])).join(' L ')} Z`, filled: true }
  const parts = []
  s.forEach((x, i) => {
    const next = s[(i + 1) % s.length]
    if (x[key] != null && next[key] != null) parts.push(`M ${xy(i, x[key])} L ${xy((i + 1) % s.length, next[key])}`)
  })
  return { d: parts.join(' '), filled: false }
}
const pleasant = computed(() => shape('pleasant'))
const unpleasant = computed(() => shape('unpleasant'))
// A slice around each axis: tapping anywhere in it picks that sense.
function slice(i) {
  const half = Math.PI / N.value
  const p = (b) => `${(ICON_R * Math.cos(b)).toFixed(2)} ${(ICON_R * Math.sin(b)).toFixed(2)}`
  return `M 0 0 L ${p(angle(i) - half)} L ${p(angle(i))} L ${p(angle(i) + half)} Z`
}
const place = (i) => {
  const [x, y] = at(i, ICON_R)
  return { left: `${((x + 150) / 300) * 100}%`, top: `${((y + 150) / 300) * 100}%` }
}
const name = (sense) => { const n = senseName(sense); return n[0].toUpperCase() + n.slice(1) }
const both = (s) => (s.pleasant == null ? 'no answers' : `pleasant ${s.pleasant}, unpleasant ${s.unpleasant}`)
const answerText = (e) => `${e.value} · ${scale.value[e.value - 1]}`
const pick = (sense) => { selected.value = selected.value === sense ? null : sense }
</script>

<template>
  <figure class="radar-block" data-testid="profile-radar">
    <p class="legend">
      <span><svg class="key" viewBox="0 0 24 8" aria-hidden="true"><line class="pleasant" x1="1" y1="4" x2="23" y2="4" /></svg>Pleasant</span>
      <span><svg class="key" viewBox="0 0 24 8" aria-hidden="true"><line class="unpleasant" x1="1" y1="4" x2="23" y2="4" /></svg>Unpleasant</span>
      <span class="muted">0 at the centre, 2 at the edge: the strongest element of each sense</span>
    </p>

    <div class="radar">
      <svg viewBox="-150 -150 300 300" aria-hidden="true">
        <circle v-for="r in [1, 2]" :key="r" class="ring" cx="0" cy="0" :r="(r / MAX) * R" />
        <line v-for="(s, i) in scores" :key="s.sense" class="axis" x1="0" y1="0" :x2="at(i, R)[0]" :y2="at(i, R)[1]" />
        <text v-for="r in [1, 2]" :key="`t${r}`" class="ring-label" x="4" :y="-(r / MAX) * R - 3">{{ r }}</text>
        <path class="pleasant" :class="{ filled: pleasant.filled }" :d="pleasant.d" data-shape="pleasant" />
        <path class="unpleasant" :class="{ filled: unpleasant.filled }" :d="unpleasant.d" data-shape="unpleasant" />
        <path v-for="(s, i) in scores" :key="`w${s.sense}`" class="slice" :class="{ on: selected === s.sense }" :d="slice(i)"
              @click="pick(s.sense)" />
      </svg>
      <span class="centre" :title="a11.title[lang]" data-testid="radar-a11">
        <span class="visually-hidden">{{ a11.title[lang] }}</span>{{ answers.A11 ?? '–' }}<span class="of">/5</span>
      </span>
      <button v-for="(s, i) in scores" :key="`i${s.sense}`" type="button" class="icon" :class="{ on: selected === s.sense, gap: s.pleasant == null }"
              :style="place(i)" :data-sense="s.sense" :aria-label="`${name(s.sense)}: ${both(s)}`"
              :aria-expanded="selected === s.sense" aria-controls="radar-detail" @click="pick(s.sense)">
        <SenseIcon :sense="s.sense" />
      </button>
    </div>

    <div id="radar-detail" class="detail" aria-live="polite" data-testid="radar-detail">
      <template v-if="picked">
        <p class="detail-title"><strong>{{ name(picked.sense) }}</strong> · {{ both(picked) }}</p>
        <ul v-if="picked.elements.length">
          <li v-for="e in picked.elements" :key="e.code">
            <span>{{ e[lang] }}</span>
            <span class="val" :class="{ p: e.pleasant, u: e.unpleasant }">{{ answerText(e) }}</span>
          </li>
        </ul>
        <p v-else class="muted">No answers for this sense.</p>
      </template>
      <p v-else class="muted">Tap a sense to see its elements.</p>
    </div>

    <figcaption class="words">
      <span class="words-title">In your words</span>
      <q v-if="answers.A16" data-testid="answer-A16">{{ answers.A16 }}</q>
      <span v-else class="muted">Nothing written.</span>
      <button type="button" class="edit" aria-label="Edit your own words" @click="emit('edit-words')">Edit</button>
    </figcaption>

    <details class="as-list">
      <summary>Show as a list</summary>
      <p>{{ a11.title[lang] }} {{ answers.A11 ?? '–' }} of 5.</p>
      <ul>
        <li v-for="s in scores" :key="`l${s.sense}`">
          <strong>{{ name(s.sense) }}</strong>: {{ both(s) }}<template v-if="s.elements.length">
            ({{ s.elements.map((e) => `${e[lang]} ${answerText(e)}`).join('; ') }})</template>
        </li>
      </ul>
    </details>
  </figure>
</template>

<style scoped>
p, ul, figure { margin: 0; }
ul { padding: 0; list-style: none; }
.radar-block { display: flex; flex-direction: column; gap: var(--space-3); }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); color: var(--text-2); }
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.key { width: var(--space-5); height: var(--space-2); }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }

.radar { position: relative; margin: 0 auto; width: min(100%, var(--radar-max)); aspect-ratio: 1; }
.radar > svg { width: 100%; height: 100%; overflow: visible; }
.ring, .axis { fill: none; stroke: var(--line); stroke-width: var(--radar-ring); }
.ring-label { fill: var(--text-muted); font-size: var(--fs-2xs); }
.pleasant, .unpleasant { fill: none; stroke-width: var(--radar-line); stroke-linejoin: round; stroke-linecap: round; }
.pleasant { stroke: var(--easy); }
.unpleasant { stroke: var(--hard); stroke-dasharray: var(--radar-dash); }
.pleasant.filled { fill: var(--easy); fill-opacity: var(--radar-fill-opacity); }
.unpleasant.filled { fill: var(--hard); fill-opacity: var(--radar-fill-opacity); }
.slice { fill: transparent; cursor: pointer; }
.slice.on { fill: var(--btn-selected-bg); fill-opacity: var(--radar-fill-opacity); }
.centre {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: grid; place-items: center; grid-auto-flow: column; align-items: baseline;
  min-width: var(--touch); height: var(--touch); padding: 0 var(--space-2); border-radius: var(--radius-pill);
  background: var(--panel); border: var(--hairline) solid var(--line);
  font-size: var(--fs-lg); font-weight: var(--fw-semibold); pointer-events: none;
}
.centre .of { font-size: var(--fs-xs); color: var(--text-muted); font-weight: var(--fw-regular); }
.icon {
  position: absolute; transform: translate(-50%, -50%);
  display: grid; place-items: center; width: var(--touch); height: var(--touch); padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: var(--text-2);
}
.icon.on { color: var(--text); background: var(--btn-selected-bg); }
.icon.gap { opacity: var(--inactive-opacity); }

.detail { min-height: calc(2 * var(--touch)); padding: var(--space-3) var(--space-4); border-radius: var(--radius-btn); background: var(--ground); border: var(--hairline) solid var(--line); }
.detail-title { margin-bottom: var(--space-2); }
.detail li { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-1) 0; }
.val { color: var(--text-2); font-size: var(--fs-sm); text-align: right; }
.val.p { color: var(--easy); }
.val.u { color: var(--hard-text); }

.words { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); }
.words-title { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); width: 100%; }
.words q { white-space: pre-wrap; overflow-wrap: anywhere; }
.edit { border: 0; background: none; padding: var(--space-2) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; }
.as-list summary { cursor: pointer; min-height: var(--touch); display: flex; align-items: center; color: var(--text-2); font-size: var(--fs-sm); }
.as-list ul { list-style: disc; padding-left: var(--space-5); display: grid; gap: var(--space-1); font-size: var(--fs-sm); }
.as-list p { font-size: var(--fs-sm); margin-bottom: var(--space-2); }
</style>
