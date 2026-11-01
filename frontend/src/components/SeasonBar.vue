<script setup>
// Season chips + time slider. Inactive until heat is ready (brief §3, season and time bar rule).
// Desktop: one bar at the bottom centre. Phone: "Summer ▾" and the slider under the top bar.
import config from '../config.js'

defineProps({ phone: Boolean })
const { season, time } = config.heatDefault
const hour = Number(time.split(':')[0])
const cap = (s) => s[0].toUpperCase() + s.slice(1)
</script>

<template>
  <div v-if="!phone" class="bar panel" data-panel="season" aria-label="Season and time (available once heat is ready)" role="group">
    <div class="seasons inactive">
      <button v-for="s in config.seasons" :key="s" type="button" class="season" :class="{ on: s === season }" disabled>
        {{ cap(s) }}
      </button>
    </div>
    <span class="divider" aria-hidden="true" />
    <label class="time inactive">
      <span class="visually-hidden">Time of day</span>
      <input type="range" min="6" max="21" :value="hour" disabled />
      <output>{{ time }}</output>
    </label>
  </div>

  <div v-else class="phone-row" role="group" aria-label="Season and time (available once heat is ready)">
    <button type="button" class="season-chip panel inactive" data-panel="season-chip" disabled>
      {{ cap(season) }} <span aria-hidden="true">▾</span>
    </button>
    <label class="time-box panel inactive" data-panel="time">
      <span class="visually-hidden">Time of day</span>
      <input type="range" min="6" max="21" :value="hour" disabled />
      <output>{{ time }}</output>
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
.season-chip {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: var(--touch-phone); padding: 0 var(--space-4);
  font-weight: var(--fw-semibold); color: var(--text);
}
.time-box {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2);
  height: var(--touch-phone); padding: 0 var(--space-2) 0 var(--space-3);
}
</style>
