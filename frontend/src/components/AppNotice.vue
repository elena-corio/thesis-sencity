<script setup>
// The message when something did not work (stores/notice.js): at the bottom of the screen, above everything, closed
// with its button, by Esc, or by itself after a few seconds.
import AppIcon from './AppIcon.vue'
import { useNoticeStore } from '../stores/notice.js'

const notice = useNoticeStore()
</script>

<template>
  <div v-if="notice.message" class="notice panel" role="alert" data-testid="app-notice" @keydown.esc="notice.hide()">
    <p>{{ notice.message }}</p>
    <button type="button" class="icon-btn" aria-label="Close the message" @click="notice.hide()"><AppIcon name="close" /></button>
  </div>
</template>

<style scoped>
.notice {
  position: fixed; left: 50%; bottom: var(--notice-bottom); transform: translateX(-50%); z-index: 60;
  display: flex; align-items: center; gap: var(--space-3);
  width: min(var(--menu-w), calc(100vw - 2 * var(--margin))); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border-left: var(--focus-width) solid var(--hard);
}
.notice p { margin: 0; flex: 1; font-size: var(--fs-sm); }
</style>
