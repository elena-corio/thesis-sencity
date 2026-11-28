<script setup>
// Account menu (board P5): header, Appearance, About (opens AboutDialog), Print; with accounts (Elena, 2026-11-22) Sign out
// and "Delete my account and data" (on the Profile page, with its confirmation).
// Esc or a click outside closes it; focus moves into the menu and back to the button.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import AppearanceSwitch from './AppearanceSwitch.vue'
import { useHelpStore } from '../stores/help.js'
import { useReportStore } from '../stores/report.js'
import { useProfileStore } from '../stores/profile.js'
import { useRouter } from 'vue-router'
import { AUTH_ON } from '../lib/auth.js'
import { useAppTestStore } from '../stores/appTest.js'

const emit = defineEmits(['close'])
const menu = ref(null)
const help = useHelpStore()
/** About replaces the menu; focus goes back to the account button when About closes. */
const report = useReportStore()
/** Print report: the menu closes (focus back on its button), then the report opens; closing it returns there. */
function print() {
  emit('close')
  report.openReport()
}
function about() {
  emit('close')
  help.openAbout()
}
const profile = useProfileStore()
const router = useRouter()
// "Rate 8 places" (the app test, Elena 2026-11-28): opens its intro, or where an unfinished test stopped; gone once done.
const appTest = useAppTestStore()
function rate() {
  emit('close')
  router.push('/app-test')
}
async function signOut() {
  emit('close')
  await profile.signOutAll()
}
function deleteAccount() {
  emit('close')
  router.push({ path: '/profile', query: { delete: '1' } })
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
function onPointerDown(e) {
  if (menu.value && !menu.value.contains(e.target) && !e.target.closest('[data-menu-button]')) emit('close')
}
onMounted(async () => {
  await nextTick()
  menu.value?.querySelector('[aria-checked="true"]')?.focus()
  document.addEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <Teleport to="body"><div class="backdrop" aria-hidden="true" /></Teleport>
  <div ref="menu" class="menu panel" role="dialog" aria-label="Your account" data-popover @keydown="onKey">
    <div class="head">
      <span class="avatar" aria-hidden="true"><AppIcon name="user" /></span>
      <div>
        <div class="name">Your account</div>
        <div class="sub">Profile and settings</div>
      </div>
    </div>
    <div class="block">
      <div class="label">Appearance</div>
      <AppearanceSwitch />
    </div>
    <div class="block items">
      <button type="button" class="item" aria-haspopup="dialog" @click="about">
        <AppIcon name="help" /> About and how to use
      </button>
      <button type="button" class="item" aria-haspopup="dialog" @click="print">
        <AppIcon name="print" /> Print report
      </button>
      <button v-if="appTest.available && profile.profile" type="button" class="item" data-testid="menu-app-test" @click="rate">
        <AppIcon name="image" /> {{ appTest.started ? `Rate ${appTest.photos.length} places (${appTest.index} done)` : `Rate ${appTest.photos.length} places` }}
      </button>
    </div>
    <div v-if="AUTH_ON" class="block items">
      <button type="button" class="item" data-testid="sign-out" @click="signOut">
        <AppIcon name="logout" /> Sign out
      </button>
      <button type="button" class="item" aria-haspopup="dialog" @click="deleteAccount">
        <AppIcon name="trash" /> Delete my account and data
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  width: min(var(--menu-w), calc(100vw - 2 * var(--margin)));
  max-height: calc(100dvh - var(--topbar-h) - 3 * var(--margin));
  overflow-y: auto;
  z-index: 20;
  text-align: left;
}
.backdrop { position: fixed; inset: 0; background: var(--backdrop); z-index: 15; }
.head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4); border-bottom: var(--hairline) solid var(--line); }
.avatar {
  width: var(--touch-phone); height: var(--touch-phone); flex: none;
  border-radius: 50%; display: grid; place-items: center;
  background: var(--btn-selected-bg); font-weight: var(--fw-semibold);
}
.name { font-weight: var(--fw-semibold); }
.sub { font-size: var(--fs-sm); color: var(--text-2); }
.block { padding: var(--space-4); }
.block + .block { border-top: var(--hairline) solid var(--line); }
.label {
  font-size: var(--fs-xs); font-weight: var(--fw-semibold); letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-2);
}
.items { display: flex; flex-direction: column; padding-top: var(--space-2); padding-bottom: var(--space-2); }
.item {
  display: flex; align-items: center; gap: var(--space-3);
  min-height: var(--touch-phone); padding: 0 var(--space-2);
  border: 0; border-radius: var(--radius-btn); background: transparent; text-align: left;
}
</style>
