<script setup>
// "Walking route B · easiest for your senses" (board Routes 5, photos and play): which way is walked.
// On a phone it fills the row under the top bar.
import { computed } from 'vue'
import { chipText } from '../lib/walk.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const text = computed(() => chipText(walk.route, walk.layer))
</script>

<template>
  <div class="chip panel" :class="{ phone }" role="status" data-panel="walk-chip">
    <span :class="['sample', walk.route.id]" aria-hidden="true" />
    <strong>{{ text.title }}</strong>
    <span class="detail">{{ text.detail }}</span>
  </div>
</template>

<style scoped>
.chip {
  display: flex; align-items: center; gap: var(--space-3); min-width: 0;
  padding: calc(var(--space-2) + 2px) var(--space-4); border-radius: var(--radius-btn); white-space: nowrap;
}
.chip strong { font-weight: var(--fw-semibold); }
.detail { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; }
.sample { display: inline-block; flex: none; width: var(--route-sample-w); height: var(--space-1); border-radius: var(--radius-pill); }
.sample.A { background: var(--text); }
.sample.B { background: linear-gradient(to right, var(--text) 30%, transparent 30%, transparent 47%, var(--text) 47%, var(--text) 77%, transparent 77%); }
.chip.phone { width: 100%; height: var(--walk-chip-h); padding: 0 var(--space-3); gap: calc(var(--space-2) + 2px); font-size: var(--fs-sm); }
</style>
