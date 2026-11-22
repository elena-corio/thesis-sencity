<script setup>
import { AUTH_ON } from '../lib/auth.js'
// Your sensory profile (board 5): every answer, each group with Edit (editing builds the profile again); on the right,
// your own words (no "Strongest for you": Elena, 2026-11-21), and the device-only actions: download,
// import, delete. The radar (ProfileRadar) under the title; under the overall comfort, the temperature that feels
// comfortable (ThermalComfortBar, from the Weather step). "Places that may suit you" comes later.
import { computed, ref } from 'vue'
import config from '../config.js'
import { GRIDS, gridRows } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import { STEPS, useProfileStore } from '../stores/profile.js'
import AppIcon from './AppIcon.vue'
import ProfileRadar from './ProfileRadar.vue'
import HowClose from './HowClose.vue'
import ThermalComfortBar from './ThermalComfortBar.vue'
import { standardLimits } from '../lib/thermal.js'
import { WEATHER } from '../lib/weather.js'
import SenseIcon from './SenseIcon.vue'
import HowLink from './HowLink.vue'
import { anyAnswered, answerText } from '../lib/prepare.js'

defineProps({ error: { type: String, default: '' } })
const emit = defineEmits(['map', 'download', 'import', 'delete'])
const store = useProfileStore()
const lang = config.language
const survey = computed(() => store.survey)
const p = computed(() => store.profile)
const question = (code) => survey.value.questions.find((q) => q.code === code)
const a11 = computed(() => question('A11'))
const words = (code) => question(code).scale[lang]
const kind = (v) => (v <= 2 ? 'bothers' : v >= 4 ? 'good' : 'neither')
const saved = computed(() => new Date(p.value.saved).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))
const edit = (code) => store.begin(STEPS.indexOf(code))
const limits = computed(() => store.limits ?? standardLimits())
const moved = computed(() => !!p.value.thermal)
// How you prepare for new places (config/prepare.json): optional, kept with the profile, never sent to the model.
const prep = computed(() => survey.value.prepare ?? null)
const prepStarted = computed(() => anyAnswered(prep.value, p.value.prepare))

// The overall comfort bar can be dragged too (Elena, 2026-11-15): it snaps to 1–5 and saves A11 when let go (or on
// each arrow key); the profile is built again, so ratings made with it before become "from your earlier profile".
const a11Track = ref(null)
const a11Drag = ref(null) // the value shown while dragging
const a11Value = computed(() => a11Drag.value ?? p.value.answers.A11)
function a11From(e) {
  const r = a11Track.value.getBoundingClientRect()
  return Math.min(5, Math.max(1, Math.round(1 + ((e.clientX - r.left) / r.width) * 4)))
}
function a11Down(e) {
  e.currentTarget.setPointerCapture?.(e.pointerId)
  e.currentTarget.focus()
  a11Drag.value = a11From(e)
}
function a11Move(e) {
  if (a11Drag.value != null) a11Drag.value = a11From(e)
}
async function a11Up() {
  if (a11Drag.value == null) return
  const v = a11Drag.value
  await store.setAnswer('A11', v)
  a11Drag.value = null
}
function a11Key(e) {
  const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]
  if (d == null) return
  e.preventDefault()
  store.setAnswer('A11', Math.min(5, Math.max(1, p.value.answers.A11 + d)))
}
</script>

<template>
  <div class="summary" data-panel="profile-summary">
    <section class="main" aria-labelledby="profile-title">
      <h2 id="profile-title" tabindex="-1">This is how you sense the city</h2>
      <p class="sub">From your answers, on a scale from 1 to 5 · saved on {{ saved }} · <HowLink section="data" /></p>
      <ProfileRadar :survey="survey" :answers="p.answers" />
      <HowClose />

      <details class="answers" data-testid="answers">
        <summary><span>Your answers, element by element</span><AppIcon name="chevronDown" class="chev" /></summary>
        <div v-for="(g, gi) in GRIDS" :key="g" class="group">
          <div class="group-head">
            <h3>{{ gi === 0 ? question(g).title[lang] : 'More elements' }}</h3>
            <button type="button" class="edit" :aria-label="`Edit the elements, part ${gi + 1} of 2`" @click="edit(g)">Edit</button>
          </div>
          <ul class="rows">
            <li v-for="r in gridRows(survey, g)" :key="r.code" :data-testid="`answer-${r.code}`">
              <SenseIcon :sense="r.icon_key" :label="senseName(r.icon_key)" />
              <span class="name">{{ r[lang] }}</span>
              <span class="score" :class="kind(p.answers[g][r.code])">{{ p.answers[g][r.code] }} · {{ words(g)[p.answers[g][r.code] - 1] }}</span>
            </li>
          </ul>
        </div>
        <div class="group" data-testid="answers-weather">
          <div class="group-head">
            <h3>{{ WEATHER.title[lang] }}</h3>
            <button type="button" class="edit" aria-label="Edit the weather" @click="edit('weather')">Edit</button>
          </div>
          <ul class="rows">
            <li v-for="r in WEATHER.rows" :key="r.code" :data-testid="`answer-weather-${r.code}`">
              <AppIcon :name="r.icon" class="plain-icon" />
              <span class="name">{{ r[lang] }}</span>
              <span v-if="p.weather?.[r.code]" class="score" :class="kind(p.weather[r.code])">{{ p.weather[r.code] }} · {{ words('A12')[p.weather[r.code] - 1] }}</span>
              <span v-else class="score">Not answered</span>
            </li>
          </ul>
        </div>
      </details>
    </section>

    <aside class="side panel" aria-label="Your words and your data">
      <!-- Overall sensory comfort (A11): the comfort bar of the place card (board 2c), at the top of the right card (Elena). -->
      <div class="overall" data-testid="overall-comfort">
        <div class="card-head">
          <h3 id="overall-title">Overall sensory comfort</h3>
          <strong>{{ a11Value }} of 5</strong>
          <button type="button" class="edit" :aria-label="`Edit: ${a11.title[lang]}`" @click="edit('A11')">Edit</button>
        </div>
        <p class="overall-q">{{ a11.title[lang] }}</p>
        <div class="bar" data-testid="overall-bar">
        <div ref="a11Track" class="track" @pointerdown="a11Down" @pointermove="a11Move" @pointerup="a11Up" @pointercancel="a11Up">
          <button type="button" class="a11-handle" :style="{ left: `${((a11Value - 1) / 4) * 100}%` }" role="slider"
                  aria-labelledby="overall-title" :aria-valuemin="1" :aria-valuemax="5" :aria-valuenow="a11Value"
                  :aria-valuetext="`${a11Value} of 5, from 1, ${a11.labels['1'][lang].toLowerCase()}, to 5, ${a11.labels['5'][lang].toLowerCase()}`"
                  data-handle="A11" @keydown="a11Key">
            <span class="diamond" aria-hidden="true" />
          </button>
        </div>
        <div class="ticks" aria-hidden="true"><span v-for="n in 5" :key="n">{{ n }}</span></div>
        <div class="ends" aria-hidden="true"><span>{{ a11.labels['1'][lang] }}</span><span>{{ a11.labels['5'][lang] }}</span></div>
        </div>
      </div>

      <!-- Directly under the general comfort line (Elena, 2026-11-15): local only, from the Weather step. -->
      <div class="thermal">
        <ThermalComfortBar :limits="limits" :moved="moved" @move="(side, v) => store.setStart(side, v)" @reset="store.resetStarts()" />
      </div>

      <div class="card-head">
        <h3>In your words</h3>
        <button type="button" class="edit" aria-label="Edit your own words" @click="edit('A16')">Edit</button>
      </div>
      <blockquote v-if="p.answers.A16" class="words" data-testid="answer-A16">“{{ p.answers.A16 }}”</blockquote>
      <p v-else class="muted">Nothing written.</p>

      <template v-if="prep">
        <div class="card-head">
          <h3>{{ prep.title.en }}</h3>
          <button type="button" class="edit" :aria-label="`${prepStarted ? 'Edit' : 'Answer'}: ${prep.title.en}`"
                  @click="edit('Q1')">{{ prepStarted ? 'Edit' : 'Answer' }}</button>
        </div>
        <ul v-if="prepStarted" class="prepare" data-testid="answers-prepare">
          <li v-for="pq in prep.questions" :key="pq.code" :data-testid="`answer-prepare-${pq.code}`">
            <span class="muted">{{ pq.title.en }}</span>
            <span>{{ answerText(prep, p.prepare, pq.code) || 'Not answered' }}</span>
          </li>
        </ul>
        <p v-else class="muted" data-testid="answers-prepare-empty">Optional, four short questions. Never sent to the model.</p>
      </template>

      <div class="buttons">
        <button type="button" class="btn" @click="store.begin(1)">Edit answers</button>
        <button type="button" class="btn btn-primary" @click="emit('map')">Go to map</button>
      </div>
      <div class="links">
        <button type="button" class="link" @click="emit('download')">Download my data</button>
        <button type="button" class="link" @click="emit('import')">Import a file</button>
        <button type="button" class="link" @click="emit('delete')">{{ AUTH_ON ? 'Delete my account and data' : 'Delete my profile' }}</button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </aside>
  </div>
</template>

<style scoped>
p, h2, h3, ul, blockquote { margin: 0; }
ul { padding: 0; list-style: none; }
.summary {
  display: grid; grid-template-columns: minmax(0, var(--profile-main-w)) var(--profile-side-w);
  justify-content: center; align-items: start; gap: var(--space-5);
  padding: var(--space-4) var(--margin) var(--margin);
}
.main { display: flex; flex-direction: column; gap: var(--space-4); }
h2 { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.2; }
.sub { color: var(--text-2); margin-top: calc(-1 * var(--space-3)); }
h3 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.group { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); border-top: var(--hairline) solid var(--line); }
.group-head { display: flex; align-items: baseline; gap: var(--space-3); justify-content: space-between; }
.edit { border: 0; background: none; padding: var(--space-2); min-height: var(--touch); color: var(--text-2); text-decoration: underline; flex: none; }
.overall, .thermal { padding-bottom: var(--space-3); border-bottom: var(--hairline) solid var(--line); }
.rows .plain-icon { color: var(--text-muted); }
/* The titles of the right card, one style (Elena, 2026-11-15): the title on the left, a value or Edit on the right. */
.side .card-head { display: flex; align-items: center; gap: var(--space-3); min-height: var(--touch); }
.side .card-head h3 { flex: 1; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.side .card-head strong { font-variant-numeric: tabular-nums; }
.side .card-head .edit { padding-right: 0; }
.overall-q { font-size: var(--fs-sm); color: var(--text-2); }
.bar { margin-top: var(--space-5); }
.track {
  position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill);
  background: linear-gradient(to right, var(--hard), var(--mixed), var(--easy)); cursor: pointer; touch-action: none;
}
/* The diamond is a handle: a 44 px target, dragged or moved with the arrow keys. */
.a11-handle {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: var(--touch-phone); height: var(--touch-phone); padding: 0; border: 0; background: transparent;
  display: grid; place-items: center; cursor: grab; touch-action: none;
}
.a11-handle:active { cursor: grabbing; }
.a11-handle:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: calc(-1 * var(--space-2)); border-radius: var(--radius-chip); }
.diamond {
  width: var(--handle-size); height: var(--handle-size); transform: rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
.ticks, .ends { display: flex; justify-content: space-between; margin: var(--space-2) var(--space-1) 0; font-size: var(--fs-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.ends { margin-top: 0; }
.answers { border-top: var(--hairline) solid var(--line); }
.answers summary { cursor: pointer; min-height: var(--touch); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); list-style: none; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.answers summary::-webkit-details-marker { display: none; }
.answers .chev { transition: transform var(--transition); }
.answers[open] .chev { transform: rotate(180deg); }
.answers .group + .group { margin-top: var(--space-3); }

.rows li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-1) 0; }
.rows :deep(.sense-icon) { color: var(--text-muted); }
.score { font-size: var(--fs-sm); color: var(--text-2); text-align: right; }
.score.bothers { color: var(--hard-text); }
.score.good { color: var(--easy); }

.side { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
.words { padding: var(--space-3) var(--space-4); border-radius: var(--radius-btn); background: var(--ground); white-space: pre-wrap; overflow-wrap: anywhere; }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }
.prepare { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.prepare li { display: flex; flex-direction: column; gap: var(--space-1); }
.text[open] .chev { transform: rotate(180deg); }
.buttons { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); margin-top: var(--space-2); }
.links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2) var(--space-4); }
.link { border: 0; background: none; padding: var(--space-1) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; font-size: var(--fs-sm); }
.error { color: var(--hard-text); font-size: var(--fs-sm); }

@media (max-width: 1023px) {
  .summary { grid-template-columns: minmax(0, var(--profile-main-w)); }
}
/* A phone: the title clear of the top edge (Elena, 2026-11-15). */
@media (max-width: 767px) {
  .summary { padding-top: calc(var(--margin) + var(--space-4)); }
}
</style>
