<script setup>
// Season and time, inside the layer controls (Area left panel, Routes panel, and the area or route card
// when the left panel gives way). Shown only for layers that depend on them (Thermal, Overall; not
// Senses); the choice is kept when switching layers, since it lives in the store. Active before
// analysis, where the choice is free and Analyse uses it, and again once thermal is ready; inactive while
// an area or thermal is loading. On a loaded area each new season or time is a billed run, so the slider
// asks only when let go, and arrow keys on the seasons wait a moment before asking (store debounce).
import { computed, nextTick, ref, useId, watch } from 'vue'
import config from '../config.js'

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

const group = ref(null)
/** Radiogroup keys: arrows move and choose, Home and End jump to the ends. */
function onKey(e) {
  const list = config.seasons
  const i = list.indexOf(season.value)
  const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key]
  if (next == null) return
  e.preventDefault()
  const s = list[(next + list.length) % list.length]
  props.store.setThermalWindow({ season: s })
  nextTick(() => group.value?.querySelector('[aria-checked="true"]')?.focus())
}
</script>

<template>
  <div class="season-time" data-testid="season-time">
    <div class="head">
      <span :id="labelId" class="label">Season and time</span>
      <span class="hint">Changes heat and cold</span>
    </div>
    <div ref="group" class="seasons" :class="{ inactive: !active }" role="radiogroup" :aria-labelledby="labelId"
         :aria-disabled="!active" @keydown="onKey">
      <button v-for="s in config.seasons" :key="s" type="button" role="radio" class="season" :class="{ on: s === season }"
              :aria-checked="s === season" :tabindex="s === season ? 0 : -1" :disabled="!active"
              @click="store.setThermalWindow({ season: s })">
        {{ cap(s) }}
      </button>
    </div>
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
.season-time { margin-top: var(--space-4); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.label { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.hint { font-size: var(--fs-xs); color: var(--text-2); }
.seasons {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--hairline); margin-top: var(--space-2);
  padding: var(--hairline); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.season {
  min-height: var(--touch); padding: 0 var(--space-1);
  border: 0; border-radius: var(--radius-chip); background: transparent; color: var(--text-2); font-size: var(--fs-sm);
}
.season.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.time { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); min-height: var(--touch); }
input[type="range"] { flex: 1; min-width: 0; accent-color: var(--accent); }
output {
  flex: none; padding: var(--space-1) var(--space-2); border-radius: var(--radius-chip);
  background: var(--btn-selected-bg); font-size: var(--fs-sm); font-variant-numeric: tabular-nums;
}
.wait { margin: var(--space-1) 0 0; }
@media (pointer: coarse) { .season, .time { min-height: var(--touch-phone); } }
</style>
