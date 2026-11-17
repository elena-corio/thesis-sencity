<script setup>
// "How close SenCity is to you" (Elena, 2026-11-16): from your own ratings that had a prediction on screen
// (lib/myRatings.js), no model call. Three numbers: how many, the average gap |prediction − you|, the share within 1
// point.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { allRatings, closeness } from '../lib/myRatings.js'

const entries = ref(allRatings())
const refresh = () => { entries.value = allRatings() }
onMounted(() => window.addEventListener('storage', refresh))
onBeforeUnmount(() => window.removeEventListener('storage', refresh))
defineExpose({ refresh })

const c = computed(() => closeness(entries.value))
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
</style>
