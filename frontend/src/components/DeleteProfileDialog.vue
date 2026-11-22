<script setup>
import { AUTH_ON } from '../lib/auth.js'
// "Delete my profile" (board 5c, brief §10): an alert dialog, focus on Cancel. Phase 1: everything personal is in this
// browser (the profile and the ratings made with it; the server keeps none), so this clears it and the map goes back to
// general ratings. Esc or Cancel closes it.
import { nextTick, onMounted, ref } from 'vue'

const emit = defineEmits(['cancel', 'confirm', 'download'])
defineProps({ error: { type: String, default: '' }, busy: Boolean })
const dialog = ref(null)
const cancelBtn = ref(null)

onMounted(() => nextTick(() => cancelBtn.value?.focus()))
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  } else if (e.key === 'Tab') {
    // Keep Tab inside the dialog.
    const items = [...dialog.value.querySelectorAll('button')]
    const i = items.indexOf(document.activeElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); items.at(-1).focus() }
    else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus() }
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div ref="dialog" class="dialog panel" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"
         aria-describedby="delete-text" data-panel="delete-dialog" @keydown="onKey">
      <h2 id="delete-title">{{ AUTH_ON ? 'Delete your account and data?' : 'Delete your profile?' }}</h2>
      <div id="delete-text">
        <template v-if="AUTH_ON">
          <p>This removes your answers, your own words, your sensory profile and your own ratings of places from our
            database, then your sign-in (your email address) from Clerk. You are then signed out.</p>
          <p>This cannot be undone.</p>
        </template>
        <template v-else>
          <p>This removes your answers, your own words, your sensory profile, the ratings made with it and your own ratings of
            places. The map goes back to general ratings.</p>
          <p>Everything is stored only in this browser, so it is removed from here. This cannot be undone.</p>
        </template>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>
      <button type="button" class="link" @click="emit('download')">Download a copy first</button>
      <div class="actions">
        <button ref="cancelBtn" type="button" class="btn" @click="emit('cancel')">Cancel</button>
        <button type="button" class="btn danger" :disabled="busy" @click="emit('confirm')">{{ AUTH_ON ? 'Delete my account and data' : 'Delete everything' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error { color: var(--hard-text); }
p, h2 { margin: 0; }
.backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: var(--space-4); background: var(--backdrop); }
.dialog { width: min(100%, var(--dialog-w)); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
#delete-text { display: flex; flex-direction: column; gap: var(--space-2); }
.link { align-self: flex-start; border: 0; background: none; padding: 0; color: var(--text-2); text-decoration: underline; min-height: var(--touch); }
.actions { display: flex; justify-content: flex-end; gap: var(--space-3); flex-wrap: wrap; }
.danger { background: var(--btn-danger-bg); border-color: var(--btn-danger-bg); color: var(--btn-danger-text); }
</style>
