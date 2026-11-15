<script setup>
// Your sensory profile (board 5): every answer, each group with Edit (editing builds the profile again); on the right,
// your own words, the strongest elements, the exact text the model reads, and the device-only actions: download,
// import, delete. The radar (ProfileRadar) under the title; thermal limits and "Places that may suit you" come later.
import { computed } from 'vue'
import config from '../config.js'
import { GRIDS, gridRows, strongest } from '../lib/profile.js'
import { senseName } from '../lib/senses.js'
import { STEPS, useProfileStore } from '../stores/profile.js'
import AppIcon from './AppIcon.vue'
import ProfileRadar from './ProfileRadar.vue'
import SenseIcon from './SenseIcon.vue'

defineProps({ error: { type: String, default: '' }, dev: Boolean })
const emit = defineEmits(['map', 'download', 'import', 'delete', 'test'])
const store = useProfileStore()
const lang = config.language
const survey = computed(() => store.survey)
const p = computed(() => store.profile)
const question = (code) => survey.value.questions.find((q) => q.code === code)
const a11 = computed(() => question('A11'))
const words = (code) => question(code).scale[lang]
const kind = (v) => (v <= 2 ? 'bothers' : v >= 4 ? 'good' : 'neither')
const top = computed(() => strongest(survey.value, p.value.answers))
const saved = computed(() => new Date(p.value.saved).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))
const edit = (code) => store.begin(STEPS.indexOf(code))
</script>

<template>
  <div class="summary" data-panel="profile-summary">
    <section class="main" aria-labelledby="profile-title">
      <h2 id="profile-title" tabindex="-1">This is how you sense the city</h2>
      <p class="sub">From your answers, on a scale from 1 to 5 · saved on {{ saved }}</p>
      <!-- Overall sensory comfort (A11): the comfort bar of the place card (board 2c), above the senses. -->
      <div class="overall" data-testid="overall-comfort">
        <div class="overall-head">
          <h3 id="overall-title">Overall sensory comfort</h3>
          <strong>{{ p.answers.A11 }} of 5</strong>
          <button type="button" class="edit" :aria-label="`Edit: ${a11.title[lang]}`" @click="edit('A11')">Edit</button>
        </div>
        <p class="overall-q">{{ a11.title[lang] }}</p>
        <div class="bar" data-testid="overall-bar">
        <div class="track" role="img" :aria-label="`Overall sensory comfort: ${p.answers.A11} of 5, from 1, ${a11.labels['1'][lang].toLowerCase()}, to 5, ${a11.labels['5'][lang].toLowerCase()}`">
          <span class="diamond" :style="{ left: `${((p.answers.A11 - 1) / 4) * 100}%` }" />
        </div>
        <div class="ticks" aria-hidden="true"><span v-for="n in 5" :key="n">{{ n }}</span></div>
        <div class="ends" aria-hidden="true"><span>{{ a11.labels['1'][lang] }}</span><span>{{ a11.labels['5'][lang] }}</span></div>
        </div>
      </div>

      <ProfileRadar :survey="survey" :answers="p.answers" />

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
      </details>
    </section>

    <aside class="side panel" aria-label="Your words and your data">
      <h3>In your words</h3>
      <blockquote v-if="p.answers.A16" class="words" data-testid="answer-A16">“{{ p.answers.A16 }}”</blockquote>
      <p v-else class="muted">Nothing written.</p>
      <button type="button" class="edit inline" aria-label="Edit your own words" @click="edit('A16')">Edit</button>

      <h3>Strongest for you</h3>
      <ul v-if="top.length" class="top">
        <li v-for="t in top" :key="t.row.code">
          <span class="dot" :class="t.kind" aria-hidden="true" />
          <span class="name">{{ t.row[lang] }}</span>
          <span class="muted">{{ t.kind === 'bothers' ? 'unpleasant' : 'pleasant' }} {{ t.score }}</span>
        </li>
      </ul>
      <p v-else class="muted">Nothing stands out: every element is in the middle.</p>

      <details class="text">
        <summary>Your sensory profile, as the model reads it</summary>
        <pre data-testid="profile-text">{{ p.text }}</pre>
        <p class="muted">Sent with each rating, to a model that keeps nothing. In English, with your own words as written.</p>
      </details>

      <div class="buttons">
        <button type="button" class="btn" @click="store.begin(1)">Edit answers</button>
        <button type="button" class="btn btn-primary" @click="emit('map')">Go to map</button>
      </div>
      <div class="links">
        <button type="button" class="link" @click="emit('download')">Download my data</button>
        <button type="button" class="link" @click="emit('import')">Import a file</button>
        <button type="button" class="link" @click="emit('delete')">Delete my profile</button>
        <button v-if="dev" type="button" class="link" data-dev @click="emit('test')">Load the test profile (dev only)</button>
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
.edit.inline { align-self: flex-start; padding-left: 0; }
.overall { padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); }
.overall-head { display: flex; align-items: center; gap: var(--space-3); }
.overall-head h3 { flex: 1; color: var(--text); }
.overall-head strong { font-variant-numeric: tabular-nums; }
.overall-q { font-size: var(--fs-sm); color: var(--text-2); }
/* Only the bar is as wide as the radar, and centred with it (Elena, 2026-11-15). */
.bar { width: min(100%, var(--radar-max)); margin: var(--space-5) auto 0; }
.track {
  position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill);
  background: linear-gradient(to right, var(--hard), var(--mixed), var(--easy));
}
.diamond {
  position: absolute; top: 50%; width: var(--handle-size); height: var(--handle-size);
  transform: translate(-50%, -50%) rotate(45deg);
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
.top li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-1) 0; }
.dot { width: var(--space-3); height: var(--space-3); border-radius: 50%; }
.dot.bothers { background: var(--hard); }
.dot.good { background: var(--easy); }
.text summary { cursor: pointer; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); min-height: var(--touch); display: flex; align-items: center; }
.text pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: var(--fs-xs); color: var(--text-2); background: var(--ground); padding: var(--space-3); border-radius: var(--radius-btn); margin: 0 0 var(--space-2); }
.buttons { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); margin-top: var(--space-2); }
.links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2) var(--space-4); }
.link { border: 0; background: none; padding: var(--space-1) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; font-size: var(--fs-sm); }
.error { color: var(--hard-text); font-size: var(--fs-sm); }

@media (max-width: 1023px) {
  .summary { grid-template-columns: minmax(0, var(--profile-main-w)); }
}
</style>
