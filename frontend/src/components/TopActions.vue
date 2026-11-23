<script setup>
// Top right (desktop): About, Print, light/dark, Ask (opens the chat), account. The sun/moon switches the theme with one click; System is in the account menu.
import { computed, ref } from 'vue'
import { useThemeStore } from '../stores/theme.js'
import AccountMenu from './AccountMenu.vue'
import AppIcon from './AppIcon.vue'
import { useHelpStore } from '../stores/help.js'
import { useReportStore } from '../stores/report.js'
import { useChatStore } from '../stores/chat.js'

const theme = useThemeStore()
const help = useHelpStore()
const report = useReportStore()
const menuOpen = ref(false)
const accountBtn = ref(null)

const nextTheme = computed(() => (theme.resolved === 'dark' ? 'light' : 'dark'))
function toggleTheme() {
  theme.setPreference(nextTheme.value)
}

function closeMenu() {
  menuOpen.value = false
  accountBtn.value?.focus()
}
const chat = useChatStore()
</script>

<template>
  <div class="actions panel" data-panel="actions">
    <button type="button" class="icon-btn wide-only" aria-label="About and how to use" aria-haspopup="dialog" @click="help.openAbout()">
      <AppIcon name="help" />
    </button>
    <button type="button" class="icon-btn wide-only" aria-label="Print report" aria-haspopup="dialog" @click="report.openReport()">
      <AppIcon name="print" />
    </button>
    <button type="button" class="icon-btn" :aria-label="`Switch to ${nextTheme} mode`" @click="toggleTheme">
      <AppIcon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" />
    </button>
    <button type="button" class="btn btn-primary ask" aria-label="Ask about places" :aria-expanded="chat.open" @click="chat.open ? chat.close() : chat.show()">
      <AppIcon name="chat" /><span class="ask-label">Ask</span>
    </button>
    <button ref="accountBtn" type="button" class="avatar" data-menu-button
            aria-label="Your account" aria-haspopup="dialog" :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"><AppIcon name="user" /></button>

    <!-- The account menu opens under the bar, aligned with its right edge. -->
    <AccountMenu v-if="menuOpen" @close="closeMenu" />
  </div>
</template>

<style scoped>
.actions {
  position: relative;
  display: flex; align-items: center; gap: var(--space-1);
  height: var(--topbar-h); padding: 0 var(--space-1);
}
.ask { display: inline-flex; align-items: center; gap: var(--space-2); }
.avatar {
  width: var(--touch); height: var(--touch);
  border-radius: 50%; border: var(--hairline) solid var(--line);
  background: var(--btn-selected-bg); font-weight: var(--fw-semibold);
  display: grid; place-items: center; padding: 0; color: var(--text);
}
/* Below 1024 px About and Print are reached through the account menu. */
@media (max-width: 1023px) {
  .wide-only { display: none; }
  .ask { padding: 0 var(--space-3); }
  .ask-label { display: none; }
}
</style>
