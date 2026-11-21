<script setup>
// How you prepare for new places (Elena, 2026-11-18): the optional last part of the onboarding, after the sensory
// profile, one question per screen: Q1 comfort going to a place you don't know (the thesis's A15, 1–5), Q2 how you
// prepare (tick any), Q3 how often a place feels like too much for your senses (1 never … 5 very often), Q4 what helps
// (tick any). Words from config/prepare.json (survey.prepare). Every question is optional. The answers go into the same
// draft as the profile, and the last screen's button saves it all (Elena, 2026-11-21); nothing here goes to the model.
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { complete, answered } from '../lib/profile.js'
import { isAnswered, scoreOf, toggle } from '../lib/prepare.js'
import { PROFILE_STEPS, useProfileStore } from '../stores/profile.js'
import AppLogo from './AppLogo.vue'
import ScoreChoice from './ScoreChoice.vue'

defineProps({ phone: Boolean })
const store = useProfileStore()
const router = useRouter()
const card = ref(null)

const def = computed(() => store.survey.prepare)
const answers = computed(() => store.draft?.prepare ?? {})
const editing = computed(() => !!store.draft?.editing)
const step = computed(() => Math.max(0, (store.draft?.step ?? PROFILE_STEPS.length) - PROFILE_STEPS.length))
const q = computed(() => def.value.questions[Math.min(step.value, def.value.questions.length - 1)])
const count = computed(() => def.value.questions.length)
const last = computed(() => step.value >= count.value - 1)
const words = computed(() => (q.value.type === 'scale_1_5' ? [q.value.labels['1'].en, '', '', '', q.value.labels['5'].en] : []))
const otherOption = computed(() => q.value.options?.find((o) => o.other) ?? null)
const ticked = (code) => answers.value[q.value.code]?.ticked?.includes(code) ?? false

function tick(code) {
  store.setPrepare(q.value.code, toggle(def.value, q.value.code, answers.value[q.value.code], code))
}
function setOther(text) {
  store.setPrepare(q.value.code, { ...answers.value[q.value.code], other: text })
}
async function next() {
  if (!last.value) return store.setStep(store.draft.step + 1)
  // The one save of the onboarding. A profile answer missing (a draft from before): back to it, saying so.
  if (!complete(store.survey, store.draft.answers)) {
    store.notice = 'A few answers are missing here.'
    store.setStep(PROFILE_STEPS.findIndex((c) => !answered(store.survey, store.draft.answers, c)))
    return
  }
  await store.finish()
}
/** Back: the previous question, or from the first one the profile's last step (Weather). */
function back() {
  store.setStep(store.draft.step - 1)
}
/** Skip for now (a new profile): nothing is saved yet; the draft stays on this device for later. */
function skip() {
  router.push('/area')
}
watch(step, () => nextTick(() => card.value?.querySelector('h2')?.focus()))
</script>

<template>
  <div class="onboarding" :class="{ phone }" data-panel="prepare">
    <header class="head">
      <AppLogo class="logo" />
      <span v-if="phone" class="head-title">{{ def.title.en }}</span>
      <span class="spacer" />
      <button v-if="editing" type="button" class="link" @click="store.discardDraft()">Cancel</button>
      <button v-else type="button" class="link" @click="skip">Skip for now</button>
    </header>

    <div class="body">
      <div class="progress-row">
        <span v-if="!phone" class="progress-title">{{ def.title.en }}</span>
        <span class="step" data-testid="prepare-step">Question {{ step + 1 }} of {{ count }} · optional</span>
      </div>
      <div class="progress" role="progressbar" :aria-valuemin="1" :aria-valuemax="count" :aria-valuenow="step + 1"
           :aria-valuetext="`Question ${step + 1} of ${count}`" :aria-label="def.title.en">
        <span v-for="(x, i) in def.questions" :key="x.code" class="seg" :class="{ on: i <= step }" />
      </div>

      <section ref="card" class="card panel" :aria-labelledby="`p-${q.code}`">
        <h2 :id="`p-${q.code}`" tabindex="-1">{{ q.title.en }}</h2>
        <p v-if="q.help" class="help">{{ q.help.en }}</p>

        <template v-if="q.type === 'scale_1_5'">
          <p class="help">1 = {{ q.labels['1'].en }}, 5 = {{ q.labels['5'].en }}</p>
          <div class="cols" aria-hidden="true"><span v-for="v in 5" :key="v">{{ v }}</span></div>
          <ScoreChoice :name="`prepare-${q.code}`" :label="q.title.en" bare :words="words" :model-value="scoreOf(answers, q.code)"
                       @update:model-value="store.setPrepare(q.code, $event)" />
        </template>

        <div v-else-if="q.type === 'single'" class="options" role="radiogroup" :aria-labelledby="`p-${q.code}`">
          <label v-for="o in q.options" :key="o.code" class="option" :data-option="o.code">
            <input type="radio" :name="`prepare-${q.code}`" :value="o.code" :checked="answers[q.code] === o.code"
                   @change="store.setPrepare(q.code, o.code)">
            <span>{{ o.en }}</span>
          </label>
        </div>

        <div v-else class="options" role="group" :aria-labelledby="`p-${q.code}`">
          <label v-for="o in q.options" :key="o.code" class="option" :data-option="o.code">
            <input type="checkbox" :checked="ticked(o.code)" @change="tick(o.code)">
            <span>{{ o.en }}</span>
          </label>
          <input v-if="otherOption && ticked(otherOption.code)" class="other" type="text" :maxlength="def.other_max"
                 :aria-label="`${otherOption.en}: ${q.title.en}`" :value="answers[q.code]?.other ?? ''"
                 data-testid="prepare-other" @input="setOther($event.target.value)">
        </div>

        <footer class="foot">
          <button type="button" class="btn" @click="back">Back</button>
          <span class="count" aria-live="polite">{{ isAnswered(def, answers, q.code) ? 'Answered' : 'You can leave this out' }}</span>
          <button type="button" class="btn btn-primary" @click="next">
            {{ last ? (editing ? 'Save changes' : 'Save your profile') : 'Next' }}
          </button>
        </footer>
      </section>

      <p class="note">{{ def.note.en }}</p>
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
.link { border: 0; background: none; padding: var(--space-2); min-height: var(--touch-phone); color: var(--text-2); text-decoration: underline; }
.body { width: min(100%, var(--onboarding-w)); margin-top: var(--space-5); }
.progress-row { display: flex; justify-content: space-between; font-weight: var(--fw-semibold); color: var(--text-2); }
.progress-row .step { margin-left: auto; }
.progress { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--space-1); margin: var(--space-2) 0 var(--space-4); }
.seg { height: var(--progress-h); border-radius: var(--radius-pill); background: var(--line); }
.seg.on { background: var(--text-muted); }
.card { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); line-height: 1.3; }
.help { font-size: var(--fs-sm); color: var(--text-2); }
.cols { display: grid; grid-template-columns: repeat(5, minmax(var(--score-w), 1fr)); gap: var(--space-2); color: var(--text-muted); font-size: var(--fs-sm); text-align: center; margin-top: var(--space-3); }
.options { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
.option {
  display: flex; align-items: center; gap: var(--space-3); min-height: var(--touch-phone); padding: var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); cursor: pointer;
}
.option:has(input:checked) { border-color: var(--text); }
.option input { width: var(--checkbox-size); height: var(--checkbox-size); margin: 0; flex: none; accent-color: var(--text); }
.option:has(input:focus-visible) { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.other {
  min-height: var(--touch-phone); padding: var(--space-2) var(--space-3); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn); background: transparent; color: var(--text); font: inherit;
}
.other:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.foot { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.count { flex: 1; text-align: center; color: var(--text-2); font-size: var(--fs-sm); }
.btn:disabled { opacity: var(--inactive-opacity); }
.note { margin-top: var(--space-4); text-align: center; font-size: var(--fs-sm); color: var(--text-2); }
.phone { padding: var(--space-4); }
.phone .body { margin-top: var(--space-3); }
.phone .card { padding: var(--space-4); }
</style>
