<script setup>
// A first-time hint (lib/help.js TIPS): one short tip per main view, shown until "Got it"; then never again in this
// browser, until "Show tips again" in About or "Delete my profile".
import { computed } from 'vue'
import { TIPS } from '../lib/help.js'
import { useHelpStore } from '../stores/help.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ id: { type: String, required: true }, phone: Boolean })
const help = useHelpStore()
const text = computed(() => TIPS[props.id]?.(props.phone ? 'Tap' : 'Click') ?? '')
</script>

<template>
  <aside v-if="text && help.isNew(id)" class="tip" :aria-label="`Tip`" :data-tip="id">
    <AppIcon name="info" class="tip-icon" />
    <p>{{ text }}</p>
    <button type="button" class="btn got" :aria-label="'Got it, hide this tip'" @click="help.dismiss(id)">Got it</button>
  </aside>
</template>

<style scoped>
.tip {
  display: grid; grid-template-columns: auto 1fr; align-items: start; gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: var(--btn-selected-bg); font-size: var(--fs-sm); color: var(--text);
}
.tip p { margin: 0; line-height: 1.45; }
.tip-icon { color: var(--text-2); margin-top: var(--hairline); }
.got { grid-column: 2; justify-self: start; }
</style>
