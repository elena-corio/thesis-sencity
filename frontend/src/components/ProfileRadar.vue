<script setup>
// The radar of your profile (board 5, brief §4; Elena 2026-11-15: the first version, with tapping and a list): the
// eight senses on circular rings, in the onboarding's order, icons instead of names; what bothers you (pink) and what
// feels good (cyan), 1–5 (lib/profile.js senseScores); a sense with no answers is a gap. Tapping a sense (its icon or
// its slice) lists its elements with their answers; each icon names its sense and both values. Computed from the stored
// answers only, so it changes as soon as an answer is edited; no model call.
import { computed, ref } from 'vue'
import config from '../config.js'
import { senseScores } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({ survey: { type: Object, required: true }, answers: { type: Object, required: true } })
const lang = config.language
const scores = computed(() => senseScores(props.survey, props.answers))
const scale = computed(() => props.survey.questions.find((q) => q.code === 'A12').scale[lang])
const selected = ref(null)
const picked = computed(() => scores.value.find((s) => s.sense === selected.value) ?? null)

const MAX = 5
const R = 100 // the ring of 5, in view box units
const ICON_R = 124
const N = computed(() => scores.value.length)
const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N.value
const at = (i, r) => [r * Math.cos(angle(i)), r * Math.sin(angle(i))]
const xy = (i, v) => at(i, (v / MAX) * R).map((n) => n.toFixed(2)).join(' ')

/** A shape as a path: a line between two neighbouring senses that both have answers; a sense without is a gap.
 *  Filled only when no sense is missing. */
function shape(key) {
  const s = scores.value
  if (s.every((x) => x[key] != null)) return { d: `M ${s.map((x, i) => xy(i, x[key])).join(' L ')} Z`, filled: true }
  const parts = []
  s.forEach((x, i) => {
    const next = s[(i + 1) % s.length]
    if (x[key] != null && next[key] != null) parts.push(`M ${xy(i, x[key])} L ${xy((i + 1) % s.length, next[key])}`)
  })
  return { d: parts.join(' '), filled: false }
}
const good = computed(() => shape('good'))
const bothers = computed(() => shape('bothers'))
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
const both = (s) => (s.bothers == null ? 'no answers' : `bothers you ${s.bothers}, feels good ${s.good}`)
const answerText = (e) => `${e.value} · ${scale.value[e.value - 1]}`
const pick = (sense) => { selected.value = selected.value === sense ? null : sense }
</script>

<template>
  <figure class="radar-block" data-testid="profile-radar">
    <p class="legend">
      <span><i class="swatch bothers" aria-hidden="true" />What bothers you</span>
      <span><i class="swatch good" aria-hidden="true" />What feels good</span>
    </p>

    <div class="radar">
      <svg viewBox="-150 -150 300 300" aria-hidden="true">
        <circle v-for="r in [1, 2, 3, 4, 5]" :key="r" class="ring" cx="0" cy="0" :r="(r / MAX) * R" />
        <line v-for="(s, i) in scores" :key="s.sense" class="axis" x1="0" y1="0" :x2="at(i, R)[0]" :y2="at(i, R)[1]" />
        <text v-for="r in [1, 3, 5]" :key="`t${r}`" class="ring-label" x="4" :y="-(r / MAX) * R - 3">{{ r }}</text>
        <path class="good" :class="{ filled: good.filled }" :d="good.d" data-shape="good" />
        <path class="bothers" :class="{ filled: bothers.filled }" :d="bothers.d" data-shape="bothers" />
        <path v-for="(s, i) in scores" :key="`w${s.sense}`" class="slice" :class="{ on: selected === s.sense }" :d="slice(i)"
              @click="pick(s.sense)" />
      </svg>
      <button v-for="(s, i) in scores" :key="`i${s.sense}`" type="button" class="icon" :class="{ on: selected === s.sense, gap: s.bothers == null }"
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
            <span class="val" :class="{ b: e.value <= 2, g: e.value >= 4 }">{{ answerText(e) }}</span>
          </li>
        </ul>
        <p v-else class="muted">No answers for this sense.</p>
      </template>
      <p v-else class="muted">Tap a sense to see its elements.</p>
    </div>

  </figure>
</template>

<style scoped>
p, ul, figure { margin: 0; }
ul { padding: 0; list-style: none; }
.radar-block { display: flex; flex-direction: column; gap: var(--space-3); }
.legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); color: var(--text-2); }
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.swatch { width: var(--space-4); height: var(--space-4); border-radius: var(--space-1); border: var(--radar-line) solid; display: inline-block; }
.swatch.bothers { border-color: var(--hard); }
.swatch.good { border-color: var(--easy); }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }

.radar { position: relative; margin: 0 auto; width: min(100%, var(--radar-max)); aspect-ratio: 1; }
.radar > svg { width: 100%; height: 100%; overflow: visible; }
.ring, .axis { fill: none; stroke: var(--line); stroke-width: var(--radar-ring); }
.ring-label { fill: var(--text-muted); font-size: var(--fs-2xs); }
.good, .bothers { fill: none; stroke-width: var(--radar-line); stroke-linejoin: round; stroke-linecap: round; }
.good { stroke: var(--easy); }
.bothers { stroke: var(--hard); }
.good.filled { fill: var(--easy); fill-opacity: var(--radar-fill-opacity); }
.bothers.filled { fill: var(--hard); fill-opacity: var(--radar-fill-opacity); }
.slice { fill: transparent; cursor: pointer; }
.slice.on { fill: var(--btn-selected-bg); fill-opacity: var(--radar-fill-opacity); }
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
.val.g { color: var(--easy); }
.val.b { color: var(--hard-text); }

</style>
