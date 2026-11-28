<script setup>
import { AUTH_ON } from '../lib/auth.js'
// The onboarding (boards 4, P4): Part A of the survey, one question group per screen: the eight-senses intro, A11,
// A12, A13, A16 (part_a.json, in the app's language; no attention-check rows, no health or background questions).
// A11 and every grid row are required, as in the survey; A16 is optional. Every answer is kept in a draft on this device
// as you go, so going back or leaving halfway loses nothing. After the Weather step come the optional questions about new
// places (PrepareOnboarding), and only the last of those saves the profile (Elena, 2026-11-21). Editing a saved profile
// uses the same screens, with Cancel, and the same one save at the end.
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import config from '../config.js'
import { A16_MAX, answered, gridRows } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import { WEATHER } from '../lib/weather.js'
import { rowText, textOf } from '../lib/questions.js'
import { useProfileStore } from '../stores/profile.js'
import AppLogo from './AppLogo.vue'
import ScoreChoice from './ScoreChoice.vue'

const props = defineProps({ phone: Boolean })
const store = useProfileStore()
const router = useRouter()
const lang = config.language
const card = ref(null)
const message = ref('')

const survey = computed(() => store.survey)
const draft = computed(() => store.draft)
const step = computed(() => draft.value?.step ?? 0)
// The shown steps in the layout's order, and the words on screen from config/profile_questions.json (lib/questions.js):
// only the labels change; the answers, their keys and the profile text stay.
const steps = computed(() => store.profileSteps)
const code = computed(() => steps.value[step.value])
const t = (field, fallback) => textOf(survey.value, code.value, field, fallback, lang)
const row = (r) => rowText(survey.value, code.value, r.code, r[lang], lang)
const q = computed(() => survey.value.questions.find((x) => x.code === code.value) ?? null)
const editing = computed(() => !!draft.value?.editing)

const rows = computed(() => (q.value?.type === 'grid_1_5' ? gridRows(survey.value, code.value) : []))
const answeredRows = computed(() => rows.value.filter((r) => Number.isInteger(draft.value.answers[code.value]?.[r.code])).length)
// The Weather step (optional; the app's own question, lib/weather.js): on the Part A scale, with its words.
const partAScale = computed(() => survey.value.questions.find((x) => x.code === 'A12'))
const weatherAnswered = computed(() => WEATHER.rows.filter((r) => Number.isInteger(draft.value.weather?.[r.code])).length)
const done = computed(() => answered(survey.value, draft.value.answers, code.value))
const countLine = computed(() => (rows.value.length ? `${answeredRows.value} of ${rows.value.length} answered`
  : code.value === 'weather' ? `${weatherAnswered.value} of ${WEATHER.rows.length} answered` : ''))

const a11Words = computed(() => {
  const l = q.value?.labels
  return l ? [l['1'][lang], '', '', '', l['5'][lang]] : []
})
const scaleWords = computed(() => q.value?.scale?.[lang] ?? [])

function focusTitle() {
  nextTick(() => card.value?.querySelector('h2')?.focus())
}
watch(step, () => { message.value = store.notice; store.notice = ''; focusTitle() })
// Sent back here by the save at the end because an answer is missing (stores/profile.js `notice`).
if (store.notice) { message.value = store.notice; store.notice = '' }

function next() {
  if (!done.value) {
    message.value = rows.value.length ? 'Please answer every row to go on.' : 'Please choose an answer to go on.'
    nextTick(() => {
      const first = rows.value.find((r) => !Number.isInteger(draft.value.answers[code.value]?.[r.code]))
      const sel = first ? `[data-row="${code.value}-${first.code}"] input` : 'input[type="radio"]'
      card.value?.querySelector(sel)?.focus()
    })
    return
  }
  // The last shown step with no question about new places after it (all hidden in the layout): the one save is here.
  if (step.value + 1 >= store.steps.length) return store.finish()
  store.setStep(step.value + 1)
}
function back() {
  if (step.value > 0) store.setStep(step.value - 1)
}
/** Skip for now: the answers stay on this device; the map is general until the profile is finished. */
function skip() {
  router.push('/area')
}
function cancelEdit() {
  store.discardDraft()
}
</script>

<template>
  <div class="onboarding" :class="{ phone }" data-panel="onboarding">
    <header class="head">
      <AppLogo class="logo" />
      <span v-if="phone" class="head-title">Your sensory profile</span>
      <span class="spacer" />
      <button v-if="editing" type="button" class="link" @click="cancelEdit">Cancel</button>
      <button v-else type="button" class="link" @click="skip">Skip for now</button>
    </header>

    <div v-if="survey && draft" class="body">
      <div class="progress-row">
        <span v-if="!phone" class="progress-title">Your sensory profile</span>
        <span class="step" data-testid="onboarding-step">Step {{ step + 1 }} of {{ steps.length }}</span>
      </div>
      <div class="progress" role="progressbar" :aria-valuemin="1" :aria-valuemax="steps.length" :aria-valuenow="step + 1"
           :aria-valuetext="`Step ${step + 1} of ${steps.length}`" aria-label="Your sensory profile">
        <span v-for="(s, i) in steps" :key="s" class="seg" :class="{ on: i <= step }" />
      </div>

      <section ref="card" class="card panel" :aria-labelledby="`q-${code}`">
        <template v-if="code === 'intro'">
          <h2 :id="`q-${code}`" tabindex="-1">{{ t('title', 'Before the questions') }}</h2>
          <p class="intro">{{ t('help', survey.intro[lang]) }}</p>
        </template>

        <template v-else-if="q?.code === 'A11'">
          <h2 :id="`q-${code}`" tabindex="-1">{{ t('title', q.title[lang]) }}</h2>
          <p class="help">{{ t('help', `1 = ${q.labels['1'][lang]}, 5 = ${q.labels['5'][lang]}`) }}</p>
          <div class="cols" aria-hidden="true"><span v-for="v in 5" :key="v">{{ v }}</span></div>
          <ScoreChoice name="A11" :label="t('title', q.title[lang])" bare :words="a11Words" :model-value="draft.answers.A11"
                       @update:model-value="store.answer('A11', $event)" />
        </template>

        <template v-else-if="q?.type === 'grid_1_5'">
          <h2 :id="`q-${code}`" tabindex="-1">{{ t('title', q.title[lang]) }}</h2>
          <p class="help">{{ t('help', q.help[lang]) }}</p>
          <div class="cols grid-cols" aria-hidden="true"><span v-for="v in 5" :key="v">{{ v }}</span></div>
          <ScoreChoice v-for="r in rows" :key="r.code" :name="`${code}-${r.code}`" :label="row(r)" :sense="r.icon_key"
                       :sense-name="senseName(r.icon_key)" :words="scaleWords" :model-value="draft.answers[code][r.code] ?? null"
                       @update:model-value="store.answer(code, $event, r.code)" />
        </template>

        <template v-else-if="code === 'weather'">
          <h2 :id="`q-${code}`" tabindex="-1">{{ t('title', WEATHER.title[lang]) }}</h2>
          <p class="help">{{ t('help', partAScale.help[lang]) }}</p>
          <p class="help weather-note">{{ WEATHER.note[lang] }}</p>
          <div class="cols grid-cols" aria-hidden="true"><span v-for="v in 5" :key="v">{{ v }}</span></div>
          <ScoreChoice v-for="r in WEATHER.rows" :key="r.code" :name="`weather-${r.code}`" :label="row(r)" :icon="r.icon"
                       :words="partAScale.scale[lang]" :model-value="draft.weather?.[r.code] ?? null"
                       @update:model-value="store.answer('weather', $event, r.code)" />
        </template>

        <template v-else-if="q?.code === 'A16'">
          <h2 :id="`q-${code}`" tabindex="-1">
            <label for="a16">{{ t('title', q.title[lang]) }}</label>
          </h2>
          <p id="a16-help" class="help">{{ t('help', q.help[lang]) }}</p>
          <textarea id="a16" class="answer" :maxlength="A16_MAX" aria-describedby="a16-help" :value="draft.answers.A16"
                    @input="store.answer('A16', $event.target.value)" />
        </template>

        <p v-if="message" class="message" role="alert">{{ message }}</p>

        <footer class="foot">
          <button type="button" class="btn" :disabled="step === 0" @click="back">Back</button>
          <span class="count" aria-live="polite">{{ countLine }}</span>
          <!-- Never disabled: pressing it with an answer missing says what is missing and goes there. -->
          <button type="button" class="btn btn-primary" :class="{ waiting: !done }" @click="next">Next</button>
        </footer>
      </section>

      <p class="note">{{ AUTH_ON ? 'Your answers are saved in your account when you save your profile. For a rating they go to a model that keeps nothing.'
        : 'Your answers stay on this device. They leave it only with a rating, to a model that keeps nothing.' }}</p>
    </div>
  </div>
</template>

<style scoped>
p, h2 { margin: 0; }
.onboarding {
  height: 100%; overflow-y: auto; background: var(--ground);
  padding: var(--margin); display: flex; flex-direction: column; align-items: center;
}
.head { width: 100%; display: flex; align-items: center; gap: var(--space-3); }
.logo { width: var(--logo-size); height: var(--logo-size); }
.head-title { font-weight: var(--fw-semibold); }
.spacer { flex: 1; }
.link { border: 0; background: none; padding: var(--space-2); color: var(--text-2); text-decoration: underline; }

.body { width: min(100%, var(--onboarding-w)); container: onboarding / inline-size; margin-top: var(--space-5); }
.progress-row { display: flex; justify-content: space-between; font-weight: var(--fw-semibold); color: var(--text-2); }
.progress-row .step { margin-left: auto; }
.progress { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--space-1); margin: var(--space-2) 0 var(--space-4); }
.seg { height: var(--progress-h); border-radius: var(--radius-pill); background: var(--line); }
.seg.on { background: var(--text-muted); }

.card { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); line-height: 1.3; }
h2 label { cursor: text; }
.intro { font-size: var(--fs-md); color: var(--text); margin-top: var(--space-2); }
.help { font-size: var(--fs-sm); color: var(--text-2); }
.cols { display: grid; grid-template-columns: repeat(5, minmax(var(--score-w), 1fr)); gap: var(--space-2); color: var(--text-muted); font-size: var(--fs-sm); text-align: center; margin-top: var(--space-3); }
.grid-cols { grid-template-columns: repeat(5, var(--score-w)); justify-content: end; }
.answer {
  min-height: var(--answer-text-h); resize: vertical; margin-top: var(--space-2);
  padding: var(--space-3); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; color: var(--text); font: inherit;
}
.answer:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.message { color: var(--hard-text); font-size: var(--fs-sm); }
.weather-note { color: var(--text-muted); }
.foot { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.count { flex: 1; text-align: center; color: var(--text-2); font-size: var(--fs-sm); }
.btn:disabled { opacity: var(--inactive-opacity); }
.btn-primary.waiting { opacity: var(--inactive-opacity); }
.note { margin-top: var(--space-4); text-align: center; font-size: var(--fs-sm); color: var(--text-2); }

@container onboarding (max-width: 560px) {
  .grid-cols { grid-template-columns: repeat(5, 1fr); }
  .card { padding: var(--space-4); }
}
.phone { padding: var(--space-4); }
.phone .body { margin-top: var(--space-3); }
</style>
