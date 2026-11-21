<script setup>
// The Profile view, over the map: the onboarding while one is open (also when you left it halfway), else your profile
// (board 5) or the empty state (5b). Everything stays on this device (phase 1); the delete dialog is board 5c.
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProfileStore } from '../stores/profile.js'
import ConsentScreen from './ConsentScreen.vue'
import DeleteProfileDialog from './DeleteProfileDialog.vue'
import ProfileEmpty from './ProfileEmpty.vue'
import ProfileOnboarding from './ProfileOnboarding.vue'
import PrepareOnboarding from './PrepareOnboarding.vue'
import ProfileSummary from './ProfileSummary.vue'
import FirstHint from './FirstHint.vue'

defineProps({ phone: Boolean })
const store = useProfileStore()
const router = useRouter()
const dev = import.meta.env.DEV
const fileInput = ref(null)
const page = ref(null)
const error = ref('')
const deleting = ref(false)
let deleteOpener = null

onMounted(() => store.ensureSurvey())

function focusHeading() {
  nextTick(() => page.value?.querySelector('h2')?.focus())
}
// The onboarding closed (saved, or an edit cancelled): focus moves to the heading of what shows now.
watch(() => !!store.draft, (open, was) => { if (was && !open) focusHeading() })

function download() {
  const data = store.fileData()
  if (!data) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'sencity-profile.json'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function pickFile() {
  error.value = ''
  if (!store.consented) {
    store.consentFor = 'import' // "Before you start" first
    return
  }
  fileInput.value?.click()
}
function onAgree() {
  if (store.agree() === 'import') fileInput.value?.click()
}
function onDecline() {
  const fromCreate = !store.consentFor
  store.decline()
  if (fromCreate) router.push('/area')
  else focusHeading()
}
async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    error.value = 'This file could not be read as a SenCity profile.'
    return
  }
  error.value = await store.importData(data)
  if (!error.value) focusHeading()
}

function askDelete() {
  deleteOpener = document.activeElement
  deleting.value = true
}
function cancelDelete() {
  deleting.value = false
  nextTick(() => deleteOpener?.focus?.())
}
function confirmDelete() {
  store.deleteAll()
  deleting.value = false
  focusHeading()
}
async function loadTest() {
  await store.loadTestProfile()
  focusHeading()
}
</script>

<template>
  <div ref="page" class="profile-page" data-panel="profile" data-scrollable>
    <ConsentScreen v-if="store.askingConsent && store.survey" :phone="phone" @agree="onAgree" @decline="onDecline" />
    <PrepareOnboarding v-else-if="store.draft && store.inPrepare && store.survey?.prepare" :phone="phone" />
    <ProfileOnboarding v-else-if="store.draft && store.survey" :phone="phone" />
    <template v-else>
      <FirstHint v-if="store.survey && store.profile" id="profile" :phone="phone" class="first-hint" />
      <div v-if="store.surveyStatus === 'error'" class="state" role="alert">
        <p>{{ store.surveyError }}</p>
        <button type="button" class="btn" @click="store.ensureSurvey()">Retry</button>
      </div>
      <p v-else-if="!store.survey" class="state" role="status">Loading the questions…</p>
      <ProfileSummary v-else-if="store.profile" :error="error" @map="router.push('/area')" @download="download"
                      @import="pickFile" @delete="askDelete" />
      <ProfileEmpty v-else :error="error" :dev="dev" @create="store.begin()" @import="pickFile" @test="loadTest" />
    </template>
    <input ref="fileInput" type="file" accept="application/json,.json" class="visually-hidden" tabindex="-1"
           aria-hidden="true" @change="onFile">
    <DeleteProfileDialog v-if="deleting" @cancel="cancelDelete" @confirm="confirmDelete" @download="download" />
  </div>
</template>

<style scoped>
.profile-page { height: 100%; overflow-y: auto; background: var(--ground); }
.first-hint {
  width: min(calc(100% - 2 * var(--margin)), calc(var(--profile-main-w) + var(--profile-side-w) + var(--space-5)));
  margin: var(--space-4) auto 0;
}
.state { margin: var(--space-5) auto; max-width: var(--onboarding-w); text-align: center; color: var(--text-2); display: grid; gap: var(--space-3); justify-items: center; padding: var(--space-4); }
.profile-page :deep(h2[tabindex="-1"]), .profile-page :deep(h2) { scroll-margin-top: var(--space-5); }
</style>
