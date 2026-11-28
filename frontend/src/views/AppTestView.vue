<script setup>
// The in-app test (D197; docs/decisions.md 2026-11-28): optional, offered right after the profile questions (?from=profile)
// and later from "Rate 8 places" (account menu, Profile), until it is finished. Three screens:
// 1. intro: what comes next, the information sheet, an unticked box; Start (only once ticked) or "Skip for now" (to the
//    map; nothing is saved, this browser only remembers the skip). An unfinished test goes on at its next photo.
// 2. one screen per photo, the same photos in the same order for everyone: the survey's scenario line and the photo;
//    the app's estimate for you (1–5 and what may bother / what may please, the map's own personal prediction); then
//    your rating, B1 in the survey's exact words and scale; then "Were the reasons right for you?" and a short text.
// 3. the end: thanks, and how many places you rated.
// The estimate comes before your rating on purpose (the test asks whether it is useful); this can pull ratings towards
// it, which the thesis log records as a limitation (D197). Never "persona": "the app's estimate", "your profile".
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '../components/AppLogo.vue'
import ScoreChoice from '../components/ScoreChoice.vue'
import SenseItem from '../components/SenseItem.vue'
import { useMedia } from '../composables.js'
import config from '../config.js'
import { B1, B1_WORDS, CONSENT_TEXT, REASONS, SCENARIO } from '../lib/appTest.js'
import { AUTH_ON } from '../lib/auth.js'
import { sourceOf } from '../lib/photos.js'
import { bySense, levelWord } from '../lib/senses.js'
import { useAppTestStore } from '../stores/appTest.js'
import { useProfileStore } from '../stores/profile.js'

const router = useRouter()
const route = useRoute()
// Where the test was opened from: right after the profile questions, or later (saved with the session).
const entry = route.query.from === 'profile' ? 'profile' : 'later'
const store = useAppTestStore()
const profile = useProfileStore()
const phone = useMedia('(max-width: 767px)')
const page = ref(null)

const ticked = ref(false)
const ready = ref(false)
const total = computed(() => store.photos.length)
const p = computed(() => store.photo)
const est = computed(() => (p.value ? store.estimates[p.value.id] : null))
const settled = computed(() => !!est.value && est.value.status !== 'pending')

// This photo's answers, cleared for each new photo.
const rating = ref(null)
const reasons = ref(null)
const text = ref('')
const message = ref('')
const busy = ref(false)

const photoUrl = computed(() => (p.value ? sourceOf(p.value).url(p.value) : null))
const credit = computed(() => (p.value ? sourceOf(p.value).credit(p.value) : ''))
const bothers = computed(() => bySense(est.value?.result?.bothers ?? []))
const pleases = computed(() => bySense(est.value?.result?.feels_good ?? []))
const comfortWords = (n) => (n === 1 ? B1.ends[0] : n === 5 ? B1.ends[1] : config.comfortWords[n])

onMounted(async () => {
  if (AUTH_ON && (await profile.syncAccount()) === 'notice') return router.replace({ name: 'welcome', query: { notice: '1' } })
  await store.load()
  ready.value = true
  // Agreed before and coming back: the estimates are needed again.
  if (store.consent === 'yes' && !store.atEnd) store.estimate(profile.profile)
})

async function begin() {
  busy.value = true
  const ok = await store.choose(true, entry)
  busy.value = false
  if (ok) store.estimate(profile.profile)
}

function focusTitle() {
  nextTick(() => page.value?.querySelector('h1, h2')?.focus())
}
watch(() => store.index, () => {
  rating.value = null
  reasons.value = null
  text.value = ''
  message.value = ''
  focusTitle()
})
watch(() => store.consent, focusTitle)
watch(settled, (s) => { if (s && p.value) store.shown(p.value.id) }, { immediate: true })

/** "Skip for now": to the map. Nothing is sent; the entry point stays until the test is finished. */
function skipForNow() {
  store.skip()
  router.push('/area')
}

async function next(skip = false) {
  if (!skip && rating.value == null) {
    message.value = 'Please choose a rating to go on, or skip this place.'
    nextTick(() => page.value?.querySelector('[data-row="B1"] input')?.focus())
    return
  }
  busy.value = true
  await store.submit({ rating: skip ? null : rating.value, reasonsRight: skip ? null : reasons.value, freeText: skip ? '' : text.value })
  busy.value = false
}
</script>

<template>
  <!-- One screen tall; the photo screen is long, so it scrolls inside (brief §3: never the page itself). -->
  <main ref="page" class="app-test" :class="{ phone }" data-panel="app-test" data-scrollable>
    <header class="head">
      <AppLogo class="logo" />
      <span class="head-title">Rate {{ total || 8 }} places</span>
      <span class="spacer" />
      <!-- On the intro, its own two buttons; during the test, back to the map (what is saved stays, it goes on later). -->
      <button v-if="store.consent !== 'unset' || store.atEnd" type="button" class="link" @click="router.push('/area')">
        {{ store.atEnd ? 'Close' : 'Leave for now' }}</button>
    </header>

    <section v-if="!ready || store.status === 'loading'" class="card panel" aria-busy="true">
      <p class="muted">Loading…</p>
    </section>

    <section v-else-if="store.status === 'closed' || store.status === 'error'" class="card panel" aria-labelledby="t-closed">
      <h1 id="t-closed" tabindex="-1">{{ store.status === 'closed' ? 'Not open yet' : 'Something did not work' }}</h1>
      <p>{{ store.error }}</p>
      <div class="actions">
        <button type="button" class="btn" @click="router.push('/profile')">Back to your profile</button>
        <button v-if="store.status === 'error'" type="button" class="btn btn-primary" @click="store.load()">Try again</button>
      </div>
    </section>

    <section v-else-if="!profile.profile" class="card panel" aria-labelledby="t-profile">
      <h1 id="t-profile" tabindex="-1">Make your profile first</h1>
      <p>The app's estimate for each place comes from your profile, so it is needed before this test.</p>
      <div class="actions"><button type="button" class="btn btn-primary" @click="router.push('/profile')">Go to your profile</button></div>
    </section>

    <!-- 1. Consent -->
    <section v-else-if="store.consent === 'unset'" class="card panel" aria-labelledby="t-consent" data-testid="app-test-consent">
      <h1 id="t-consent" tabindex="-1">Next: rate {{ total }} places</h1>
      <p>You will see {{ total }} places in Vienna, one at a time, about 10 minutes. For each one you first see the app's
        estimate for you, then you give your own rating.</p>
      <p class="muted">Optional, for a master's thesis, separate from the survey. You can stop at any time and go on later.</p>
      <p><a :href="store.infoSheetUrl" target="_blank" rel="noopener">Read the information sheet</a></p>
      <label class="agree">
        <input v-model="ticked" type="checkbox" data-testid="app-test-box">
        <span>{{ CONSENT_TEXT }}</span>
      </label>
      <p class="muted" aria-live="polite" data-testid="app-test-saving">{{ ticked ? 'Your answers will be saved, without your name or email.'
        : 'Tick the box to start. If you skip, nothing from this test is saved.' }}</p>
      <p v-if="store.saveError" class="message" role="alert">{{ store.saveError }}</p>
      <div class="actions">
        <button type="button" class="btn" data-testid="app-test-skip" @click="skipForNow">Skip for now</button>
        <button type="button" class="btn btn-primary" :disabled="busy || !ticked" data-testid="app-test-start" @click="begin">Start</button>
      </div>
    </section>

    <!-- 3. The end -->
    <section v-else-if="store.atEnd" class="card panel" aria-labelledby="t-end" data-testid="app-test-end">
      <h1 id="t-end" tabindex="-1">Thank you</h1>
      <p data-testid="app-test-count">You rated {{ store.rated }} {{ store.rated === 1 ? 'place' : 'places' }}.</p>
      <p class="muted">{{ store.saving ? 'Your answers are saved.' : 'Nothing from this test was saved, as you chose.' }}</p>
      <div class="actions">
        <button type="button" class="btn" @click="router.push('/profile')">Back to your profile</button>
        <button type="button" class="btn btn-primary" @click="router.push('/area')">Go to the map</button>
      </div>
    </section>

    <!-- 2. One photo -->
    <section v-else-if="p" class="card panel" :aria-labelledby="`t-place-${p.order}`" :data-photo="p.id">
      <div class="progress-row">
        <h2 :id="`t-place-${p.order}`" tabindex="-1" data-testid="app-test-place">Place {{ store.index + 1 }} of {{ total }}</h2>
        <span v-if="!store.saving" class="muted">Not saved</span>
      </div>
      <div class="progress" aria-hidden="true"><span v-for="(x, i) in store.photos" :key="x.id" class="seg" :class="{ on: i <= store.index }" /></div>
      <p class="scenario">{{ SCENARIO }}</p>
      <figure class="photo">
        <img v-if="photoUrl" :src="photoUrl" alt="The street photo of this place" width="640" height="640">
        <figcaption class="credit">{{ credit }}</figcaption>
      </figure>

      <div class="estimate" aria-live="polite" data-testid="app-test-estimate">
        <h3>The app's estimate for you</h3>
        <p v-if="!settled" class="muted">Getting the app's estimate…</p>
        <p v-else-if="est.status === 'failed'" class="muted">The app could not make an estimate for this place. You can still rate it.</p>
        <template v-else>
          <p class="level"><span class="dot" :class="est.estimate.level" aria-hidden="true" />
            <strong>{{ levelWord(est.estimate.level) }}</strong> · {{ est.estimate.comfort }} of 5, {{ comfortWords(est.estimate.comfort) }}</p>
          <div class="reasons">
            <div>
              <h4>What may bother you</h4>
              <ul v-if="bothers.length"><SenseItem v-for="r in bothers" :key="r.sense" :row="r" kind="bother" /></ul>
              <p v-else class="muted">Nothing in particular.</p>
            </div>
            <div>
              <h4>What may please you</h4>
              <ul v-if="pleases.length"><SenseItem v-for="r in pleases" :key="r.sense" :row="r" kind="good" /></ul>
              <p v-else class="muted">Nothing in particular.</p>
            </div>
          </div>
          <p class="muted">A prediction, not a reason.</p>
        </template>
      </div>

      <template v-if="settled">
        <div class="question">
          <h3 id="b1-title">{{ B1.title }}</h3>
          <p class="muted">{{ B1.help }}</p>
          <p class="muted">1 = {{ B1.ends[0] }}, 5 = {{ B1.ends[1] }}</p>
          <div class="cols" aria-hidden="true"><span v-for="v in 5" :key="v">{{ v }}</span></div>
          <ScoreChoice name="B1" :label="B1.title" bare :words="B1_WORDS" :model-value="rating" @update:model-value="rating = $event; message = ''" />
        </div>

        <fieldset v-if="rating != null && est.status === 'ok'" class="question reasons-q" data-testid="app-test-reasons">
          <legend>Were the reasons right for you?</legend>
          <div class="options">
            <label v-for="r in REASONS" :key="r.code" class="option">
              <input v-model="reasons" type="radio" name="reasons" :value="r.code"><span>{{ r.label }}</span>
            </label>
          </div>
          <label for="app-test-text" class="text-label">Anything to add? (optional)</label>
          <textarea id="app-test-text" v-model="text" class="answer" :maxlength="store.freeTextMax" rows="3" />
        </fieldset>

        <p v-if="message || store.saveError" class="message" role="alert">{{ message || store.saveError }}</p>
        <footer class="foot">
          <button type="button" class="btn" :disabled="busy" @click="next(true)">Skip this place</button>
          <button type="button" class="btn btn-primary" :disabled="busy" data-testid="app-test-next" @click="next()">
            {{ store.index + 1 === total ? 'Finish' : 'Next' }}</button>
        </footer>
      </template>
    </section>
  </main>
</template>

<style scoped>
p, h1, h2, h3, h4, ul, figure { margin: 0; }
ul { padding: 0; list-style: none; }
.app-test { position: relative; height: 100dvh; overflow-y: auto; background: var(--ground); padding: var(--margin); display: flex; flex-direction: column; align-items: center; gap: var(--space-5); }
.phone { padding: var(--space-4); }
.head { width: 100%; display: flex; align-items: center; gap: var(--space-3); }
.logo { width: var(--logo-size); height: var(--logo-size); color: var(--logo); }
.head-title { font-weight: var(--fw-semibold); }
.spacer { flex: 1; }
.link { border: 0; background: none; padding: var(--space-2); min-height: var(--touch); color: var(--text-2); text-decoration: underline; }
.card { width: min(100%, var(--onboarding-w)); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
.phone .card { padding: var(--space-4); }
h1 { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.2; }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
h3 { font-size: var(--fs-md); font-weight: var(--fw-semibold); }
h4 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); margin-bottom: var(--space-1); }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }
a { color: var(--text); }
.agree {
  display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); align-items: start; cursor: pointer;
  padding: var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.agree input { width: var(--space-5); height: var(--space-5); margin: 0; accent-color: var(--btn-primary-bg); }
.actions, .foot { display: flex; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.btn:disabled { opacity: var(--inactive-opacity); }
.progress-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.progress { display: flex; gap: var(--space-1); }
.seg { flex: 1; height: var(--space-1); border-radius: var(--radius-pill); background: var(--line); }
.seg.on { background: var(--accent); }
.scenario { color: var(--text-2); }
.photo { position: relative; width: min(100%, var(--app-test-photo)); align-self: center; }
.photo img { display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-btn); background: var(--line); }
.credit { position: absolute; right: var(--space-2); bottom: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-chip);
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); font-size: var(--fs-xs); }
.estimate { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); }
.level { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.dot { width: var(--space-3); height: var(--space-3); border-radius: 50%; flex: none; }
.dot.easy { background: var(--easy); }
.dot.mixed { background: var(--mixed); }
.dot.hard { background: var(--hard); }
.reasons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.phone .reasons { grid-template-columns: 1fr; }
.cols { display: grid; grid-template-columns: repeat(5, minmax(var(--score-w), 1fr)); gap: var(--space-2); color: var(--text-muted); font-size: var(--fs-sm); text-align: center; margin-top: var(--space-2); }
.question { display: flex; flex-direction: column; gap: var(--space-2); }
fieldset.question { border: 0; padding: 0; margin: 0; }
legend { font-size: var(--fs-md); font-weight: var(--fw-semibold); padding: 0; margin-bottom: var(--space-2); }
.options { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.option { display: flex; align-items: center; gap: var(--space-2); min-height: var(--touch); padding: 0 var(--space-4);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); cursor: pointer; }
.option:has(input:checked) { border-color: var(--accent); outline: var(--hairline) solid var(--accent); }
.text-label { font-size: var(--fs-sm); color: var(--text-2); margin-top: var(--space-2); }
.answer { width: 100%; font: inherit; color: var(--text); background: var(--panel); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn); padding: var(--space-3); resize: vertical; }
.message { color: var(--text); font-size: var(--fs-sm); }
input:focus-visible, textarea:focus-visible, a:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
</style>
