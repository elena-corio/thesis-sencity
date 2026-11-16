<script setup>
// "How this works": opens About at the matching section (lib/help.js ABOUT_SECTIONS).
import { useHelpStore } from '../stores/help.js'

defineProps({ section: { type: String, required: true } })
const help = useHelpStore()
</script>

<template>
  <button type="button" class="how-link" :data-how="section" aria-haspopup="dialog" @click="help.openAbout(section)">How this works</button>
</template>

<style scoped>
.how-link {
  align-self: flex-start; padding: 0; border: 0; background: none; font: inherit; font-size: var(--fs-xs);
  color: var(--text-2); text-decoration: underline; text-underline-offset: var(--space-1);
}
@media (pointer: coarse) {
  .how-link { min-height: var(--touch-phone); }
}
</style>
