<script setup>
// Welcome (board 0a; Elena, 2026-11-22): the one page anyone can open. "Create your profile" shows the privacy notice
// first (ConsentScreen, accounts version), then Clerk's sign-up; "Sign in" goes to Clerk directly. Nothing is saved
// before the notice is agreed: the agreement waits in this tab until the account exists, then is recorded on the server.
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsentScreen from '../components/ConsentScreen.vue'
import AppLogo from '../components/AppLogo.vue'
import { isSignedIn, ready } from '../lib/auth.js'
import { useMedia } from '../composables.js'
import { useProfileStore } from '../stores/profile.js'

const router = useRouter()
const route = useRoute()
const profile = useProfileStore()
const phone = useMedia('(max-width: 767px)')
// ?notice=1: signed in, but the notice is not agreed yet (an account from before it existed): show it.
const notice = ref(route.query.notice === '1')
const STEPS = ['Tell us what bothers you and what feels good, about 5 minutes', 'See the map for you, with thermal comfort for any season and time', 'Compare routes and places before you go']

onMounted(async () => {
  await ready()
  if (isSignedIn() && !notice.value) router.replace('/area')
})

async function agree() {
  if (isSignedIn()) {
    await profile.agreeOnServer()
    router.replace('/profile')
  } else {
    profile.consentPending()
    router.push('/sign-in')
  }
}
</script>

<template>
  <ConsentScreen v-if="notice" account :phone="phone" @agree="agree" @decline="notice = false" />
  <main v-else class="welcome" :class="{ phone }" data-panel="welcome">
    <div class="text">
      <AppLogo class="logo" />
      <h1>How will this place feel for you?</h1>
      <p class="lead">Maps tell you how to get somewhere, not how it will feel when you arrive: too loud, too bright, too hot, or just right.</p>
      <p class="lead">SenCity predicts how streets and squares in Vienna may feel for your senses, so you can choose places and routes that work for you.</p>
      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="i"><span class="n">{{ i + 1 }}</span><span>{{ s }}</span></li>
      </ol>
      <div class="actions">
        <button type="button" class="btn btn-primary big" @click="notice = true">Create your profile</button>
        <button type="button" class="btn big" @click="router.push('/sign-in')">Sign in</button>
      </div>
      <p class="foot">Predictions, not reasons. Your answers stay private.<br>Part of a master thesis final project.</p>
    </div>
  </main>
</template>

<style scoped>
p, h1, ol { margin: 0; }
.welcome { min-height: 100dvh; background: var(--ground); display: flex; align-items: center; padding: var(--space-5) var(--margin); }
.text { width: min(100%, var(--onboarding-w)); margin-left: clamp(0px, 6vw, calc(var(--space-5) * 4)); display: flex; flex-direction: column; gap: var(--space-4); }
.logo { width: calc(var(--logo-size) * 2); height: calc(var(--logo-size) * 2); color: var(--logo); }
h1 { font-size: var(--fs-display); font-weight: var(--fw-semibold); line-height: 1.1; }
.lead { color: var(--text-2); font-size: var(--fs-md); }
.steps { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.steps li { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); align-items: center; }
.n { display: grid; place-items: center; width: var(--touch-phone); height: var(--touch-phone); border: var(--hairline) solid var(--line); border-radius: 50%; font-size: var(--fs-sm); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); }
.big { min-height: var(--touch-phone); }
.foot { color: var(--text-muted); font-size: var(--fs-sm); }
.phone { padding: var(--space-4); align-items: flex-start; }
.phone .text { margin-left: 0; }
</style>
