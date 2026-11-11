<script setup>
// The end of a Senses card, for an area and for routes alike: what kind of rating this is, and the status line.
import { computed } from 'vue'
import { GENERAL_LABEL, runStatusLine } from '../lib/senses.js'
import { useSensesStore } from '../stores/senses.js'

const props = defineProps({ scope: { type: String, required: true } })
const senses = useSensesStore()
const run = computed(() => senses.runs[props.scope])
const rated = computed(() => (props.scope === 'area' ? senses.areaProgress : senses.routesProgress).rated)
const showStatus = computed(() => run.value.model && !['idle', 'rating'].includes(run.value.status))
</script>

<template>
  <div class="senses-foot" data-testid="senses-foot">
    <p class="general">{{ GENERAL_LABEL }}</p>
    <p v-if="showStatus" class="status" data-testid="senses-status">{{ runStatusLine(run, rated) }}</p>
  </div>
</template>

<style scoped>
p { margin: 0; }
.senses-foot { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.general { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.status { margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
</style>
