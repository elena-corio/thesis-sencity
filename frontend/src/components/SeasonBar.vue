<script setup>
// Season chips + time slider. Active before analysis, where the choice is free and Analyse uses it, and
// again once thermal is ready; inactive while an area or thermal is loading (brief §3, season and time
// bar rule). Desktop: one bar at the bottom centre. Phone: a season menu and the slider under the top
// bar. On a loaded area each new season or time is a billed run, so the slider asks only when let go.
import { computed, ref, watch } from 'vue'
import config from '../config.js'

const props = defineProps({
  phone: Boolean,
  /** The store that owns the window: the area or the routes (the same three fields). */
  store: { type: Object, required: true },
})
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const hourOf = (time) => Number(time.split(':')[0])
const timeOf = (hour) => `${String(hour).padStart(2, '0')}:00`

const active = computed(() => props.store.windowActive)
const label = computed(() => (active.value ? 'Season and time' : 'Season and time (available once this area has loaded)'))
const season = computed(() => props.store.thermalWindow.season)
// The slider's position while it is dragged, before the time is asked for.
const hour = ref(hourOf(props.store.thermalWindow.time))
watch(() => props.store.thermalWindow.time, (t) => { hour.value = hourOf(t) })
</script>

<template>
  <div v-if="!phone" class="bar panel" data-panel="season" :aria-label="label" role="group">
    <div class="seasons" :class="{ inactive: !active }">
      <button v-for="s in config.seasons" :key="s" type="button" class="season" :class="{ on: s === season }"
              :disabled="!active" :aria-pressed="s === season" @click="store.setThermalWindow({ season: s })">
        {{ cap(s) }}
      </button>
    </div>
    <span class="divider" aria-hidden="true" />
    <label class="time" :class="{ inactive: !active }">
      <span class="visually-hidden">Time of day</span>
      <input v-model.number="hour" type="range" min="6" max="21" :disabled="!active"
             @change="store.setThermalWindow({ time: timeOf(hour) })" />
      <output>{{ timeOf(hour) }}</output>
    </label>
  </div>

  <div v-else class="phone-row" role="group" :aria-label="label">
    <div class="season-chip panel" :class="{ inactive: !active }" data-panel="season-chip">
      <select :value="season" aria-label="Season" :disabled="!active"
              @change="store.setThermalWindow({ season: $event.target.value })">
        <option v-for="s in config.seasons" :key="s" :value="s">{{ cap(s) }}</option>
      </select>
    </div>
    <label class="time-box panel" :class="{ inactive: !active }" data-panel="time">
      <span class="visually-hidden">Time of day</span>
      <input v-model.number="hour" type="range" min="6" max="21" :disabled="!active"
             @change="store.setThermalWindow({ time: timeOf(hour) })" />
      <output>{{ timeOf(hour) }}</output>
    </label>
  </div>
</template>

<style scoped>
.bar {
  display: flex; align-items: center; gap: var(--space-3);
  height: var(--topbar-h); padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
}
.seasons { display: flex; gap: var(--space-1); }
.season {
  min-height: var(--touch); padding: 0 var(--space-3);
  border: 0; border-radius: var(--radius-btn); background: transparent; color: var(--text-2);
}
.season.on { background: var(--btn-selected-bg); color: var(--text); font-weight: var(--fw-semibold); }
.divider { width: var(--hairline); height: var(--space-5); background: var(--line); }
.time { display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; }
input[type="range"] { flex: 1; min-width: var(--range-min-w); accent-color: var(--accent); }
output {
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-chip);
  background: var(--btn-selected-bg); font-size: var(--fs-sm);
}

.phone-row { display: flex; gap: var(--gap); flex: 1; min-width: 0; }
.season-chip { display: inline-flex; align-items: center; height: var(--touch-phone); padding: 0 var(--space-2); }
.season-chip select {
  height: 100%; border: 0; background: transparent; color: var(--text);
  font: inherit; font-weight: var(--fw-semibold);
}
.season-chip option { background: var(--panel); color: var(--text); }
.time-box {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2);
  height: var(--touch-phone); padding: 0 var(--space-2) 0 var(--space-3);
}
</style>
