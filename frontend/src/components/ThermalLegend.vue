<script setup>
// Thermal legend (Area left panel and Routes panel, always the last block). Title "Thermal comfort °C"
// with a small info icon: its tooltip explains the feels-like temperature and names the source, on
// hover, keyboard focus or tap (touch has no hover); Esc, blur or a tap elsewhere close it. Easy always
// shows its range; Mixed and Hard only the side the values on screen reach (heat, cold or both).
// Standard limits for everyone, from the config.
import { computed, ref, useId } from 'vue'
import { easyRange, thermalLegend, thermalLimits, thermalSide } from '../lib/thermal.js'
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
const deg = (v) => String(v).replace('-', '−')
const info = computed(() => {
  const [lo, hi] = easyRange(limits.value)
  return 'Feels-like temperature (UTCI). How hot or cold it feels on the body: air temperature, sun, shade, ' +
    `wind and humidity together. Easy is ${deg(lo)} to ${deg(hi)} °C, where most people feel no heat or cold ` +
    'stress. Simulated by Infrared.city.'
})
const tipId = useId()
const focused = ref(false)
const hovered = ref(false)
const shown = computed(() => focused.value || hovered.value)
function onKey(e) {
  if (e.key !== 'Escape' || !shown.value) return
  e.preventDefault()
  e.stopPropagation() // Esc closes the tooltip, not the area or the route
  focused.value = false
  hovered.value = false
}
</script>

<template>
  <div class="thermal-legend">
    <h2 class="legend-title">
      Thermal comfort °C
      <span class="info" tabindex="0" role="img" :aria-label="info" :aria-describedby="shown ? tipId : undefined"
            @focus="focused = true" @blur="focused = false" @click="focused = true"
            @mouseenter="hovered = true" @mouseleave="hovered = false" @keydown="onKey">
        <AppIcon name="info" class="info-icon" />
        <span v-if="shown" :id="tipId" class="tip" role="tooltip" data-testid="thermal-info">{{ info }}</span>
      </span>
    </h2>
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
  </div>
</template>

<style scoped>
/* The tooltip spans the legend's width, just above it. */
.thermal-legend { position: relative; }
.legend-title {
  display: flex; align-items: center; gap: var(--space-2); margin: 0;
  font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text);
}
/* A plain icon, no button frame; focusable, with the usual focus outline. */
.info { display: inline-grid; place-items: center; color: var(--text-2); cursor: help; border-radius: 50%; }
.info .info-icon { width: var(--icon-sm); height: var(--icon-sm); }
.tip {
  position: absolute; left: 0; right: 0; bottom: calc(100% + var(--space-2)); z-index: 2;
  padding: var(--space-2) var(--space-3); border: var(--hairline) solid var(--line); border-radius: var(--radius-chip);
  background: var(--panel); box-shadow: var(--shadow); color: var(--text);
  font-size: var(--fs-sm); font-weight: var(--fw-regular); line-height: var(--lh); white-space: normal;
}
.legend { list-style: none; padding: 0; margin: var(--space-2) 0 0; display: grid; gap: var(--space-2); }
.legend li { display: flex; align-items: flex-start; gap: var(--space-2); }
.swatch { width: var(--space-5); height: var(--swatch-h); margin-top: calc((1em * var(--lh) - var(--swatch-h)) / 2); border-radius: var(--radius-pill); flex: none; }
.row-text { display: flex; flex-direction: column; }
.sub { color: var(--text-2); font-size: var(--fs-sm); }
</style>
