<script setup>
// The radar of your profile (board 5, brief §4): the eight senses on circular rings, icons instead of names; what
// bothers you (pink) and what feels good (cyan), 1–5 (lib/profile.js senseScores). Pointing at a sense, or focusing
// its icon, shows its name and both values; a table says the same to screen readers.
import { computed, ref } from 'vue'
import config from '../config.js'
import { senseScores } from '../lib/profile.js'
import { SENSE_ORDER, senseName } from '../lib/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({ survey: { type: Object, required: true }, answers: { type: Object, required: true } })
const lang = config.language
const scores = computed(() => senseScores(props.survey, props.answers, SENSE_ORDER))
const shown = ref(null) // the sense pointed at or focused

const N = SENSE_ORDER.length
const R = 100 // the ring of 5
const ICON_R = 124 // where the icons sit
const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N
const at = (i, r) => [r * Math.cos(angle(i)), r * Math.sin(angle(i))]
const pt = (i, r) => at(i, r).map((v) => v.toFixed(2)).join(',')
const radius = (v) => ((v ?? 0) / 5) * R

const polygon = (key) => scores.value.map((s, i) => pt(i, radius(s[key]))).join(' ')
const RINGS = [1, 2, 3, 4, 5]
// A wedge around each axis: pointing anywhere in it shows that sense.
const wedge = (i) => {
  const half = Math.PI / N
  const a = angle(i)
  const p = (b) => `${(ICON_R * 1.1 * Math.cos(b)).toFixed(2)},${(ICON_R * 1.1 * Math.sin(b)).toFixed(2)}`
  return `0,0 ${p(a - half)} ${p(a)} ${p(a + half)}`
}
// The icons, as HTML over the SVG: their place in % of the square (the view box is −150…150).
const iconStyle = (i) => {
  const [x, y] = at(i, ICON_R)
  return { left: `${((x + 150) / 300) * 100}%`, top: `${((y + 150) / 300) * 100}%` }
}
const label = (s) => `${senseName(s.sense)[0].toUpperCase()}${senseName(s.sense).slice(1)}`
const describe = (s) => `${label(s)}: bothers you ${s.bothers ?? '–'}, feels good ${s.good ?? '–'}`
const tip = computed(() => {
  const i = scores.value.findIndex((s) => s.sense === shown.value)
  if (i < 0) return null
  const s = scores.value[i]
  const [x, y] = at(i, ICON_R)
  return { s, style: { left: `${((x + 150) / 300) * 100}%`, top: `${((y + 150) / 300) * 100}%` }, below: y < 0 }
})
</script>

<template>
  <figure class="radar" data-testid="profile-radar" @mouseleave="shown = null">
    <svg viewBox="-150 -150 300 300" aria-hidden="true">
      <circle v-for="r in RINGS" :key="r" class="ring" cx="0" cy="0" :r="radius(r)" />
      <line v-for="(s, i) in scores" :key="s.sense" class="axis" x1="0" y1="0" :x2="at(i, R)[0]" :y2="at(i, R)[1]" />
      <text v-for="r in [1, 3, 5]" :key="`t${r}`" class="ring-label" x="4" :y="-radius(r) - 3">{{ r }}</text>
      <polygon class="good" :points="polygon('good')" />
      <polygon class="bothers" :points="polygon('bothers')" />
      <polygon v-for="(s, i) in scores" :key="`w${s.sense}`" class="wedge" :points="wedge(i)"
               @mouseenter="shown = s.sense" />
    </svg>
    <span v-for="(s, i) in scores" :key="`i${s.sense}`" class="icon" :class="{ on: shown === s.sense }" :style="iconStyle(i)"
          tabindex="0" role="img" :aria-label="describe(s)" :data-sense="s.sense"
          @mouseenter="shown = s.sense" @focus="shown = s.sense" @blur="shown = null">
      <SenseIcon :sense="s.sense" />
    </span>
    <div v-if="tip" class="tip" :class="{ below: tip.below }" :style="tip.style" role="presentation" data-testid="radar-tip">
      <strong>{{ label(tip.s) }}</strong>
      <span><i class="dot bothers" />bothers you {{ tip.s.bothers ?? '–' }}</span>
      <span><i class="dot good" />feels good {{ tip.s.good ?? '–' }}</span>
      <span class="from">{{ tip.s.elements.map((e) => e[lang]).join('; ') }}</span>
    </div>
    <table class="visually-hidden">
      <caption>Your senses, from your answers, 1 to 5</caption>
      <thead><tr><th scope="col">Sense</th><th scope="col">What bothers you</th><th scope="col">What feels good</th></tr></thead>
      <tbody>
        <tr v-for="s in scores" :key="`r${s.sense}`"><th scope="row">{{ label(s) }}</th><td>{{ s.bothers ?? '–' }}</td><td>{{ s.good ?? '–' }}</td></tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.radar { position: relative; margin: 0 auto; width: min(100%, var(--radar-max)); aspect-ratio: 1; }
svg { width: 100%; height: 100%; overflow: visible; }
.ring { fill: none; stroke: var(--line); stroke-width: var(--radar-ring); }
.axis { stroke: var(--line); stroke-width: var(--radar-ring); }
.ring-label { fill: var(--text-muted); font-size: var(--fs-2xs); }
.good, .bothers { stroke-width: var(--radar-line); stroke-linejoin: round; fill-opacity: var(--radar-fill-opacity); }
.good { stroke: var(--easy); fill: var(--easy); }
.bothers { stroke: var(--hard); fill: var(--hard); }
.wedge { fill: transparent; stroke: none; }
.icon {
  position: absolute; transform: translate(-50%, -50%);
  display: grid; place-items: center; width: var(--touch); height: var(--touch); border-radius: 50%;
  color: var(--text-2); cursor: default;
}
.icon.on { color: var(--text); background: var(--btn-selected-bg); }
.icon:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.tip {
  position: absolute; transform: translate(-50%, calc(-100% - var(--touch) / 2 - var(--space-1)));
  display: flex; flex-direction: column; gap: var(--space-1); min-width: max-content; max-width: var(--panel-left-w);
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-chip);
  background: var(--panel); border: var(--hairline) solid var(--line); box-shadow: var(--shadow);
  font-size: var(--fs-sm); pointer-events: none; z-index: 1;
}
.tip.below { transform: translate(-50%, calc(var(--touch) / 2 + var(--space-1))); }
.tip span { display: flex; align-items: center; gap: var(--space-2); color: var(--text-2); }
.tip .from { color: var(--text-muted); font-size: var(--fs-xs); white-space: normal; max-width: var(--panel-left-w); }
.dot { width: var(--space-2); height: var(--space-2); border-radius: 50%; display: inline-block; }
.dot.bothers { background: var(--hard); }
.dot.good { background: var(--easy); }
</style>
