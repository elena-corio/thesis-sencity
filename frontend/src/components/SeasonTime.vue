<script setup>
// Season and time, inside the layer controls (Area left panel, Routes panel, and the area or route card
// when the left panel gives way). Shown only for layers that depend on them (Thermal, Overall; not
// Senses); the choice is kept when switching layers, since it lives in the store. Active before
// analysis, where the choice is free and Analyse uses it, and again once thermal is ready; inactive while
// an area or thermal is loading. On a loaded area each new season or time is a billed run, so the slider
// asks only when let go, and arrow keys on the seasons wait a moment before asking (store debounce).
import { computed, ref, useId, watch } from 'vue'
import config from '../config.js'
import ChoiceButtons from './ChoiceButtons.vue'

const props = defineProps({
  /** The store that owns the window: the area or the routes (the same three fields). */
  store: { type: Object, required: true },
})
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const hourOf = (time) => Number(time.split(':')[0])
const timeOf = (hour) => `${String(hour).padStart(2, '0')}:00`
const labelId = useId()

const active = computed(() => props.store.windowActive)
const season = computed(() => props.store.thermalWindow.season)
// The slider's position while it is dragged, before the time is asked for.
const hour = ref(hourOf(props.store.thermalWindow.time))
watch(() => props.store.thermalWindow.time, (t) => { hour.value = hourOf(t) })

const seasons = config.seasons.map((s) => ({ id: s, label: cap(s) }))
</script>

<template>
  <div class="season-time" data-testid="season-time">
    <div class="head">
      <span :id="labelId" class="label">Season and time</span>
      <span class="hint">Changes heat and cold</span>
    </div>
    <ChoiceButtons class="seasons" :labelledby="labelId" :options="seasons" :value="season" :disabled="!active"
                   @choose="store.setThermalWindow({ season: $event })" />
    <label class="time" :class="{ inactive: !active }">
      <span class="visually-hidden">Time of day</span>
      <input v-model.number="hour" type="range" :min="config.thermalHours.min" :max="config.thermalHours.max"
             :disabled="!active" @change="store.setThermalWindow({ time: timeOf(hour) })" />
      <output>{{ timeOf(hour) }}</output>
    </label>
    <p v-if="!active" class="hint wait">Available once this has loaded.</p>
  </div>
</template>

<style scoped>
.season-time { margin-top: calc(var(--space-4) + var(--space-1)); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.label { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.hint { font-size: var(--fs-xs); color: var(--text-2); }
.seasons { margin-top: var(--space-2); }
/* No taller than its content, so the space under it matches the space above the block. */
.time { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); min-height: var(--choice-thin-h); }
input[type="range"] { flex: 1; min-width: 0; accent-color: var(--accent); }
output {
  flex: none; padding: var(--space-1) var(--space-2); border-radius: var(--radius-chip);
  background: var(--btn-selected-bg); font-size: var(--fs-sm); font-variant-numeric: tabular-nums;
}
.wait { margin: var(--space-1) 0 0; }
@media (pointer: coarse), (max-width: 767px) { .time { min-height: var(--touch-phone); } }
</style>
