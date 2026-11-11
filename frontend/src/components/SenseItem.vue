<script setup>
// One thing that might bother or feel good (boards Routes 5, P2, P6): the icon of its main sense, from the codebook
// (model/app_v0/elements.json), and its label. A row, never a pill: no border. Used by the walk, the place card and the
// stretch card, so they read the same.
import { computed } from 'vue'
import { elementLabel } from '../lib/senses.js'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({
  /** The element from the codebook: { code, sense, en, … } */
  element: { type: Object, required: true },
  /** 'bother' | 'good': the icon's colour */
  kind: { type: String, required: true },
  small: Boolean,
})
const label = computed(() => elementLabel(props.element))
</script>

<template>
  <li class="sense-item" :class="[kind, { small }]">
    <SenseIcon :sense="element.sense" :label="label.sense" />
    <span>{{ label.text }}</span>
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
