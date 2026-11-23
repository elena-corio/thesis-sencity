<script setup>
// "Before you start" (board 3, brief §3; text by Elena, 2026-11-15): before a new profile's first question and before an
// import. The box is unticked at first and "Agree and start" works only once it is ticked. Not now goes back without
// keeping anything. With accounts (`account`, Elena 2026-11-22) it is the privacy notice before sign-up: what is stored,
// where, how long, how to delete it; nothing is saved until it is agreed.
import { nextTick, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import AppLogo from './AppLogo.vue'

const props = defineProps({ phone: Boolean, account: Boolean })
const emit = defineEmits(['agree', 'decline'])
const agreed = ref(false)
const title = ref(null)
onMounted(() => nextTick(() => title.value?.focus()))

const DEVICE = [
  { icon: 'chat', text: 'You’ll answer a few questions about what feels pleasant or unpleasant to your senses in public spaces: 20 visible elements, about 5 minutes. No health questions.' },
  { icon: 'lock', text: 'Your answers stay in this browser. There’s no account, and nothing is saved on a server.' },
  { icon: 'send', text: 'When you ask for a personal rating, your answers are sent with the photo to an AI model in the EU, used only for that rating, and not kept by the provider.' },
  { icon: 'trash', text: 'You can change, download or delete your profile at any time under Profile.' },
]
// The privacy notice with accounts: plain words, no health questions asked, nothing about who runs the study.
const ACCOUNT = [
  { icon: 'chat', text: 'You’ll answer a few questions about what feels pleasant or unpleasant to your senses in public spaces: 20 visible elements, about 5 minutes. No health questions.' },
  { icon: 'lock', text: 'What is stored: your email address, for signing in; your sensory profile (your answers, your weather and comfort settings, how you prepare for new places); and your own ratings of street photos. Chats are not saved.' },
  { icon: 'area', text: 'Where: sign-in is handled by Clerk, Inc. (USA), which stores your email address in the US under the EU–US Data Privacy Framework; everything else is stored in our database in Frankfurt (EU).' },
  { icon: 'send', text: 'For a personal rating or a chat question, what is needed (your answers, or your question) is sent to an AI model on an EU endpoint that keeps nothing.' },
  { icon: 'trash', text: 'How long: until you delete your account. Under Profile, “Delete my account and data” removes your profile, your ratings and your sign-in at once. You can download your data first.' },
]
const POINTS = props.account ? ACCOUNT : DEVICE
</script>

<template>
  <div class="consent" :class="{ phone }" data-panel="consent">
    <header class="head"><AppLogo class="logo" /></header>
    <section class="card panel" aria-labelledby="consent-title">
      <h2 id="consent-title" ref="title" tabindex="-1">{{ account ? 'Before you sign up' : 'Before you start' }}</h2>
      <ul class="points">
        <li v-for="p in POINTS" :key="p.icon"><AppIcon :name="p.icon" /><span>{{ p.text }}</span></li>
      </ul>
      <label class="agree">
        <input v-model="agreed" type="checkbox" data-testid="consent-box">
        <span>{{ account ? 'I have read this and agree that my profile and ratings are stored as described.'
          : 'I have read this and agree that my answers are used to build my profile and personalise ratings.' }}</span>
      </label>
      <div class="actions">
        <button type="button" class="btn" @click="emit('decline')">Not now</button>
        <button type="button" class="btn btn-primary" :disabled="!agreed" @click="emit('agree')">{{ account ? 'Agree and continue' : 'Agree and start' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
p, h2, ul { margin: 0; }
ul { padding: 0; list-style: none; }
.consent { height: 100%; overflow-y: auto; background: var(--ground); padding: var(--margin); display: flex; flex-direction: column; align-items: center; }
.phone { padding: var(--space-4); }
.head { width: 100%; }
.logo { width: var(--logo-size); height: var(--logo-size); }
.card { width: min(100%, var(--onboarding-w)); margin-top: var(--space-5); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
h2 { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.2; }
.points { display: flex; flex-direction: column; gap: var(--space-4); }
.points li { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); align-items: start; color: var(--text-2); }
.points :deep(.icon) { color: var(--text-muted); margin-top: var(--space-1); }
.agree {
  display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); align-items: start; cursor: pointer;
  padding: var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.agree input { width: var(--space-5); height: var(--space-5); margin: 0; accent-color: var(--btn-primary-bg); }
.agree input:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.actions { display: flex; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.btn:disabled { opacity: var(--inactive-opacity); }
</style>
