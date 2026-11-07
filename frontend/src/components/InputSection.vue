<script setup>
// The area or walk inputs at the top of the left panel (or of the sheet): closed, one row with the
// current values and a chevron; open, the fields (slot). "Change" clears every value at once and goes
// back to clicking on the map.
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'

defineProps({
  /** "Stephansplatz · 200 m", "48.2097° N, 16.3708° E → …" */
  summary: { type: String, required: true },
  expanded: Boolean,
  /** Something is set, so Change has something to clear. */
  canChange: Boolean,
  /** What Change clears, for screen readers: "Change area: clear the centre and radius". */
  changeLabel: { type: String, required: true },
})
const emit = defineEmits(['toggle', 'change'])
const bodyId = useId()
</script>

<template>
  <section class="inputs" data-testid="inputs">
    <div class="row">
      <button type="button" class="summary" :aria-expanded="expanded" :aria-controls="bodyId" @click="emit('toggle')">
        <span class="text" lang="de">{{ summary }}</span>
        <AppIcon name="chevronDown" class="chevron" :class="{ open: expanded }" />
      </button>
      <button v-if="canChange" type="button" class="btn change" :aria-label="changeLabel" @click="emit('change')">Change</button>
    </div>
    <div v-show="expanded" :id="bodyId" class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: var(--space-2); }
.summary {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2);
  min-height: var(--touch); padding: 0 var(--space-2) 0 0;
  border: 0; background: transparent; color: var(--text); text-align: left; font-weight: var(--fw-semibold);
}
.text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.chevron { flex: none; color: var(--text-2); transition: transform var(--transition); }
.chevron.open { transform: rotate(180deg); }
.change { flex: none; min-height: var(--touch); padding: 0 var(--space-3); }
.body { margin-top: var(--space-2); }
@media (pointer: coarse) { .summary, .change { min-height: var(--touch-phone); } }
@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
</style>
