<script setup>
// The general prediction on the place card (board 2c): waiting, the failure with Retry, or the rating on its
// 1–5 bar, what might bother and feel good with sense icons, and the model's explanation. Model text is shown
// as text only.
import { computed } from 'vue'
import { comfortLabel, elementLabel, statusLine } from '../lib/senses.js'
import AppIcon from './AppIcon.vue'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({
  /** The prediction of the photo on the card (stores/senses.js). */
  entry: { type: Object, required: true },
})
defineEmits(['retry'])
const r = computed(() => props.entry.result)
const rows = (elements) => elements.map((e) => ({ code: e.code, icon: e.sense, ...elementLabel(e) }))
const lists = computed(() => [
  { title: 'Might bother', kind: 'bother', items: rows(r.value.bothers) },
  { title: 'Might feel good', kind: 'good', items: rows(r.value.feels_good) },
])
</script>

<template>
  <p v-if="entry.status === 'loading'" class="waiting" role="status">
    <span class="spinner" aria-hidden="true" /> Asking the model about this photo…
  </p>

  <div v-else-if="entry.status === 'error'" class="failed" role="alert" data-testid="senses-error">
    <p class="failed-title"><AppIcon name="info" /> Could not get a prediction</p>
    <p class="failed-text">{{ entry.error }}</p>
    <p class="muted">The photo and the map still work.</p>
    <button type="button" class="btn btn-primary" @click="$emit('retry')">Retry</button>
  </div>

  <div v-else data-testid="senses-result">
    <div class="scale">
      <div class="scale-head">
        <span>Senses · comfort from photo, general</span>
        <strong>{{ comfortLabel(r.comfort) }}</strong>
      </div>
      <div class="track" role="img" :aria-label="`Comfort ${r.comfort} of 5`">
        <span class="diamond" :style="{ left: `${((r.comfort - 1) / 4) * 100}%` }" />
      </div>
      <div class="ticks" aria-hidden="true"><span v-for="n in 5" :key="n">{{ n }}</span></div>
      <p class="general">General prediction: not yet personal</p>
      <p class="muted">A prediction, not a reason.</p>
    </div>

    <section v-for="l in lists" :key="l.kind" class="list">
      <h3>{{ l.title }}</h3>
      <ul :class="l.kind">
        <li v-for="e in l.items" :key="e.code"><SenseIcon :sense="e.icon" :label="e.sense" /><span>{{ e.text }}</span></li>
      </ul>
    </section>

    <section class="list">
      <h3>Model's explanation</h3>
      <p class="reason">{{ r.reason }}</p>
    </section>

    <p class="status" data-testid="senses-status">{{ statusLine(r) }}</p>
  </div>
</template>

<style scoped>
p { margin: 0; }
.muted { margin-top: var(--space-1); font-size: var(--fs-sm); color: var(--text-2); }
.waiting { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); color: var(--text-2); }
.spinner {
  flex: none; width: var(--icon); height: var(--icon);
  border: var(--focus-width) solid var(--line); border-top-color: var(--text); border-radius: 50%;
  animation: spin var(--senses-spin-s) linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-style: dashed; } }

.failed {
  margin-top: var(--space-4); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--warning); border-radius: var(--radius-btn);
}
.failed-title { display: flex; align-items: center; gap: var(--space-2); font-weight: var(--fw-semibold); }
.failed-text { margin-top: var(--space-2); overflow-wrap: anywhere; }
.failed .btn { margin-top: var(--space-3); }

.scale {
  margin-top: var(--space-4); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.scale-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1) var(--space-3); font-size: var(--fs-sm); }
.scale-head strong { font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
.track {
  position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill);
  background: linear-gradient(to right, var(--senses-low), var(--senses-high));
}
.diamond {
  position: absolute; top: 50%; width: var(--handle-size); height: var(--handle-size);
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
.ticks {
  display: flex; justify-content: space-between; margin: var(--space-2) var(--space-1) 0;
  font-size: var(--fs-xs); color: var(--text-muted); font-variant-numeric: tabular-nums;
}

.list { margin-top: var(--space-4); }
.list h3 { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.list ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.list li { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); }
/* Senses are icons, in the colour of what they say (board 2c). */
.bother .sense-icon { color: var(--hard-text); }
.good .sense-icon { color: var(--easy); }
.reason { margin-top: var(--space-2); overflow-wrap: anywhere; }
.general { margin-top: var(--space-3); font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.status {
  margin-top: var(--space-4); padding-top: var(--space-3); border-top: var(--hairline) solid var(--line); font-size: var(--fs-xs); color: var(--text-muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums;
}
</style>
