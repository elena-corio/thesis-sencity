<script setup>
// Thermal legend (Area left panel and Routes panel). Easy always shows its range; Mixed and Hard only
// the side the values on screen reach (heat, cold or both). The info button opens the full scale for
// both sides, on click or tap (nothing on hover only). Standard limits for everyone.
import { computed, ref, useId } from 'vue'
import { thermalLegend, thermalLimits, thermalSide } from '../lib/thermal.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  /** Feels-like values (°C) of the streets on screen, for the season and time shown. */
  values: { type: Array, default: () => [] },
  /** Extra rows after Hard, e.g. "No value" on the routes. */
  extra: { type: Array, default: () => [] },
})
const limits = computed(() => thermalLimits())
const side = computed(() => thermalSide(props.values, limits.value))
const rows = computed(() => thermalLegend(limits.value, side.value))
const full = computed(() => thermalLegend(limits.value, 'both'))
const open = ref(false)
const scaleId = useId()
</script>

<template>
  <div class="thermal-legend">
    <div class="legend-head">
      <p class="legend-title">Feels like temperature, hot or cold</p>
      <button type="button" class="info" aria-label="Show the full scale, heat and cold" :aria-expanded="open"
              :aria-controls="scaleId" @click="open = !open">
        <AppIcon name="info" />
      </button>
    </div>
    <ul class="legend" data-testid="thermal-legend">
      <li v-for="r in rows" :key="r.state">
        <span class="swatch" :style="{ background: `var(--${r.state})` }" />
        <span class="row-text">
          <span>{{ r.label }}<template v-if="r.lines.length === 1">, {{ r.lines[0] }}</template></span>
          <template v-if="r.lines.length > 1"><span v-for="l in r.lines" :key="l" class="sub">{{ l }}</span></template>
        </span>
      </li>
      <li v-for="e in extra" :key="e.label">
        <span class="swatch" :style="{ background: e.color }" /><span class="row-text">{{ e.label }}</span>
      </li>
    </ul>
    <div v-if="open" :id="scaleId" class="scale" role="region" aria-label="Full scale, heat and cold">
      <p class="scale-title">Full scale</p>
      <ul class="legend">
        <li v-for="r in full" :key="r.state">
          <span class="swatch" :style="{ background: `var(--${r.state})` }" />
          <span class="row-text">
            <span>{{ r.label }}<template v-if="r.lines.length === 1">, {{ r.lines[0] }}</template></span>
            <template v-if="r.lines.length > 1"><span v-for="l in r.lines" :key="l" class="sub">{{ l }}</span></template>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.legend-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-3); }
.legend-title { margin: 0; font-size: var(--fs-sm); color: var(--text-2); }
.info {
  display: grid; place-items: center; flex: none;
  width: var(--touch); height: var(--touch); margin-right: calc(-1 * var(--space-2)); padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: var(--text-2);
}
.info[aria-expanded="true"] { color: var(--text); background: var(--btn-selected-bg); }
@media (pointer: coarse) { .info { width: var(--touch-phone); height: var(--touch-phone); } }
.legend { list-style: none; padding: 0; margin: var(--space-2) 0 0; display: grid; gap: var(--space-2); }
.legend li { display: flex; align-items: flex-start; gap: var(--space-2); }
.swatch { width: var(--space-5); height: var(--swatch-h); margin-top: calc((1em * var(--lh) - var(--swatch-h)) / 2); border-radius: var(--radius-pill); flex: none; }
.row-text { display: flex; flex-direction: column; }
.sub { color: var(--text-2); font-size: var(--fs-sm); }
.scale {
  margin-top: var(--space-3); padding: var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.scale-title { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
</style>
