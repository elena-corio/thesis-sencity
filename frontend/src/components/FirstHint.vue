<script setup>
// A first-time tip (lib/help.js TIPS), just above the part it explains. Tips in a group (the Area and the Routes
// settings) show one at a time, in order: "Tip 2 of 4", Next (Got it on the last) and Skip tips; a tip on its own has
// Got it. Once dismissed it never shows again in this browser, until "Show tips again" in About or "Delete my profile".
// Next moves focus to the next tip, so the journey can be followed from the keyboard.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TIPS } from '../lib/help.js'
import { useHelpStore } from '../stores/help.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ id: { type: String, required: true }, phone: Boolean })
const help = useHelpStore()
const text = computed(() => TIPS[props.id]?.(props.phone ? 'Tap' : 'Click') ?? '')
const on = computed(() => !!text.value && help.showing(props.id))
const pos = computed(() => help.position(props.id))
const main = ref(null)

onMounted(() => help.register(props.id))
onBeforeUnmount(() => help.unregister(props.id))

function next() {
  // Pressed from the keyboard (focus on the button): the tip that shows next takes the focus.
  if (document.activeElement === main.value) help.handoff = true
  help.dismiss(props.id)
}
watch(on, async (v) => {
  if (v && help.handoff) {
    help.handoff = false
    await nextTick()
    main.value?.focus()
  }
})
</script>

<template>
  <aside v-if="on" class="tip" aria-label="Tip" :data-tip="id">
    <AppIcon name="info" class="tip-icon" />
    <div class="tip-body">
      <p v-if="pos && pos.of > 1" class="count">Tip {{ pos.n }} of {{ pos.of }}</p>
      <p>{{ text }}</p>
      <div class="actions">
        <button ref="main" type="button" class="btn got" @click="next">{{ pos && !pos.last ? 'Next' : 'Got it' }}</button>
        <button v-if="pos && !pos.last" type="button" class="skip" @click="help.skipGroup(id)">Skip tips</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.tip {
  display: grid; grid-template-columns: auto 1fr; align-items: start; gap: var(--space-3);
  padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: var(--btn-selected-bg); font-size: var(--fs-sm); color: var(--text);
}
.tip p { margin: 0; line-height: 1.45; }
.tip-icon { color: var(--text-2); margin-top: var(--hairline); }
.tip-body { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.count { font-size: var(--fs-xs); color: var(--text-muted); }
.actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.skip {
  padding: 0; border: 0; background: none; font: inherit; font-size: var(--fs-xs); color: var(--text-2);
  text-decoration: underline; text-underline-offset: var(--space-1); min-height: var(--touch);
}
</style>
