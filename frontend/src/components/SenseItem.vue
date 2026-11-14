<script setup>
// One sense row (boards Routes 5, P2, P6): the icon of a main sense (icon_key in model/app_v9/elements.json) and the
// elements of that sense that might bother or feel good, in the codebook's order. A row, never a pill: no border.
// Used by the walk, the place card and the stretch card, so they read the same.
import { computed } from 'vue'
import { elementLabel } from '../lib/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({
  /** One row of bySense(): { sense, name, elements } */
  row: { type: Object, required: true },
  /** 'bother' | 'good': the icon's colour */
  kind: { type: String, required: true },
  small: Boolean,
})
const text = computed(() => props.row.elements.map((e) => elementLabel(e).text).join(' · '))
</script>

<template>
  <li class="sense-item" :class="[kind, { small }]" :data-sense="row.sense">
    <SenseIcon :sense="row.sense" :label="row.name" />
    <span>{{ text }}</span>
  </li>
</template>

<style scoped>
.sense-item { display: flex; align-items: center; gap: var(--space-2); padding: 2px 0; font-size: var(--fs-sm); }
.sense-item.small { font-size: var(--fs-xs); }
.sense-item :deep(.sense-icon) { width: calc(var(--icon) - 2px); height: calc(var(--icon) - 2px); }
.small :deep(.sense-icon) { width: calc(var(--icon) - 4px); height: calc(var(--icon) - 4px); }
.bother :deep(.sense-icon) { color: var(--hard-text); }
.good :deep(.sense-icon) { color: var(--easy); }
</style>
