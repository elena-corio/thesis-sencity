<script setup>
// Account menu (board P5): header, Appearance, About, Print. Account and Log out come in phase 2.
// Esc or a click outside closes it; focus moves into the menu and back to the button.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import AppearanceSwitch from './AppearanceSwitch.vue'

const emit = defineEmits(['close'])
const menu = ref(null)

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
      <span class="avatar" aria-hidden="true">EC</span>
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
      <button type="button" class="item" aria-disabled="true" title="Coming soon">
        <AppIcon name="help" /> About and how to use
      </button>
      <button type="button" class="item" aria-disabled="true" title="Coming soon">
        <AppIcon name="print" /> Print report
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
