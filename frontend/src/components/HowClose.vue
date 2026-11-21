<script setup>
// "How close SenCity is to you" (Elena, 2026-11-16): from your own ratings that had a prediction on screen
// (lib/myRatings.js), no model call. Three numbers: how many, the average gap |prediction − you|, the share within 1
// point. Then, for personal predictions, the same gap as predicted and as adjusted, and the opt-in "Adjust to my own
// ratings (experimental)" (lib/adjust.js; Elena, 2026-11-21): off by default, available from MIN_RATINGS personal ratings.
// All of that part shows only with config.js ENABLE_ADJUST (false for now): else only the predicted figures.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { MIN_RATINGS, closeness } from '../lib/myRatings.js'
import { useAdjustStore } from '../stores/adjust.js'

const adjustments = useAdjustStore()
const refresh = () => adjustments.refresh()
onMounted(() => { refresh(); window.addEventListener('storage', refresh) })
onBeforeUnmount(() => window.removeEventListener('storage', refresh))
defineExpose({ refresh })

const c = computed(() => closeness(adjustments.entries))
const a = computed(() => adjustments.closeness)
const fmt = (x) => x.toFixed(1)
const pct = (x) => `${Math.round(x * 100)}%`
</script>

<template>
  <section class="how-close" aria-labelledby="how-close-title" data-testid="how-close">
    <h3 id="how-close-title">How close SenCity is to you</h3>
    <p v-if="!c.enough" class="muted" data-testid="how-close-empty">Rate a few places to see how close SenCity is to you.</p>
    <template v-else>
      <div class="tiles">
        <p class="tile"><strong data-testid="how-close-n">{{ c.n }}</strong><span>ratings</span></p>
        <p class="tile"><strong data-testid="how-close-gap">{{ fmt(c.gap) }}</strong><span>points off on average</span></p>
        <p class="tile"><strong data-testid="how-close-within">{{ pct(c.within1) }}</strong><span>within 1 point</span></p>
      </div>
      <p class="muted small">Only ratings with a prediction on screen count. Kept on this device.</p>
    </template>

    <div v-if="adjustments.enabled" class="adjust" data-testid="adjust">
      <p v-if="a" class="compare" data-testid="adjust-compare">
        Personal predictions ({{ a.n }} ratings), points off on average:
        <span class="pair">as predicted <strong data-testid="adjust-raw">{{ fmt(a.raw) }}</strong> ({{ pct(a.within1Raw) }} within 1)</span>,
        <span class="pair">adjusted <strong data-testid="adjust-adjusted">{{ fmt(a.adjusted) }}</strong> ({{ pct(a.within1Adjusted) }} within 1)</span>.
      </p>
      <label class="toggle">
        <input type="checkbox" :checked="adjustments.on" :disabled="!adjustments.available" data-testid="adjust-toggle"
               aria-describedby="adjust-help" @change="adjustments.setOn($event.target.checked)">
        <span>Adjust to my own ratings (experimental)</span>
      </label>
      <p id="adjust-help" class="muted small">
        <template v-if="adjustments.available">Shifts your personal predictions by how far your own ratings are from them, on this device. Never sent to the model.</template>
        <template v-else>Available after {{ MIN_RATINGS }} ratings of personal predictions ({{ adjustments.count }} so far).</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
p, h3 { margin: 0; }
.how-close { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-3); border-top: var(--hairline) solid var(--line); }
h3 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.muted { color: var(--text-muted); font-size: var(--fs-sm); }
.small { font-size: var(--fs-xs); }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.tile { display: flex; flex-direction: column; gap: var(--space-1); }
.tile strong { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile span { font-size: var(--fs-xs); color: var(--text-2); }
.adjust { display: flex; flex-direction: column; gap: var(--space-2); }
.compare { font-size: var(--fs-sm); color: var(--text-2); }
.compare strong { color: var(--text); font-variant-numeric: tabular-nums; }
.pair { white-space: nowrap; }
.toggle { display: flex; align-items: center; gap: var(--space-2); min-height: var(--touch-phone); font-size: var(--fs-sm); cursor: pointer; }
.toggle input { width: var(--checkbox-size); height: var(--checkbox-size); margin: 0; flex: none; accent-color: var(--text); }
.toggle:has(input:disabled) { color: var(--text-muted); cursor: default; }
</style>
