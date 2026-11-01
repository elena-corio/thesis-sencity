<script setup>
// System / Light / Dark (brief §3, board P5). Used in the account menu and the desktop popover.
import { useThemeStore } from '../stores/theme.js'

const theme = useThemeStore()
const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
</script>

<template>
  <div class="switch" role="radiogroup" aria-label="Appearance">
    <button v-for="o in OPTIONS" :key="o.value" type="button" role="radio"
            :aria-checked="theme.preference === o.value"
            :class="{ on: theme.preference === o.value }"
            @click="theme.setPreference(o.value)">
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.switch {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-1);
  padding: var(--space-1);
  border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn);
}
button {
  min-height: var(--touch);
  border: var(--hairline) solid transparent;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-2);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
}
button.on { background: var(--btn-selected-bg); color: var(--text); border-color: var(--line); }
</style>
