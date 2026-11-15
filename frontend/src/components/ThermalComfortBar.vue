<script setup>
// "Temperature that feels comfortable to you" (Elena, 2026-11-15): feels-like °C from −20 to 40, a snowflake at the cold
// end and a sun at the hot end, so the direction reads without colour. The fill blends the map's comfort colours: hard
// (cold) → mixed → easy → mixed → hard (hot); easy is the person's comfortable range. Four ticks at their limits, the
// standard ones faint behind, so a shift shows. The start of cold and the start of hot are handles: drag them, or use
// the arrow keys (0.5 °C). Reset goes back to the weather answers. Local only: never in the profile text or a model call.
import { computed, ref } from 'vue'
import config from '../config.js'
import { comfortSummary, limitText, standardLimits } from '../lib/thermal.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  limits: { type: Object, required: true },
  /** A start was moved by hand: Reset shows. */
  moved: Boolean,
})
const emit = defineEmits(['move', 'reset'])
const { min, max } = config.thermalBar
const step = config.thermalPersonal.step
const track = ref(null)

const pct = (t) => `${((Math.min(max, Math.max(min, t)) - min) / (max - min)) * 100}%`
const std = standardLimits()
const ticks = computed(() => [props.limits.cold[1], props.limits.cold[0], props.limits.heat[0], props.limits.heat[1]])
const stdTicks = [std.cold[1], std.cold[0], std.heat[0], std.heat[1]]
const fill = computed(() => {
  const [cHard, cEasy, hMixed, hHard] = ticks.value
  const p = (t) => ((t - min) / (max - min)) * 100
  const mid = (a, b) => (p(a) + p(b)) / 2
  return `linear-gradient(to right, var(--hard) 0%, var(--hard) ${p(cHard)}%, var(--mixed) ${mid(cHard, cEasy)}%, ` +
    `var(--easy) ${p(cEasy)}%, var(--easy) ${p(hMixed)}%, var(--mixed) ${mid(hMixed, hHard)}%, var(--hard) ${p(hHard)}%, var(--hard) 100%)`
})
const summary = computed(() => comfortSummary(props.limits))
const HANDLES = [
  { side: 'cold', label: 'Start of cold' },
  { side: 'heat', label: 'Start of hot' },
]
const valueOf = (side) => (side === 'cold' ? props.limits.cold[0] : props.limits.heat[0])

function fromPointer(e) {
  const r = track.value.getBoundingClientRect()
  return min + ((e.clientX - r.left) / r.width) * (max - min)
}
let dragging = null
function down(side, e) {
  dragging = side
  e.currentTarget.setPointerCapture?.(e.pointerId)
  e.currentTarget.focus()
}
function move(e) {
  if (dragging) emit('move', dragging, fromPointer(e))
}
function up() {
  dragging = null
}
function key(side, e) {
  const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key]
  if (d == null) return
  e.preventDefault()
  emit('move', side, valueOf(side) + d)
}
</script>

<template>
  <div class="thermal-comfort" data-testid="thermal-comfort">
    <div class="card-head">
      <h3 id="thermal-comfort-title">Temperature that feels comfortable to you</h3>
      <button v-if="moved" type="button" class="link" @click="emit('reset')">Reset</button>
    </div>
    <div class="row">
      <AppIcon name="snowflake" class="end" aria-hidden="true" />
      <div ref="track" class="track" :style="{ background: fill }" @pointermove="move" @pointerup="up" @pointercancel="up">
        <span v-for="t in stdTicks" :key="`s${t}`" class="tick standard" :style="{ left: pct(t) }" aria-hidden="true" />
        <span v-for="(t, i) in ticks" :key="`p${i}`" class="tick mine" :style="{ left: pct(t) }" aria-hidden="true" data-tick />
        <button v-for="h in HANDLES" :key="h.side" type="button" class="handle" :style="{ left: pct(valueOf(h.side)) }"
                role="slider" :aria-label="h.label" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="valueOf(h.side)"
                :aria-valuetext="`${h.label}: ${limitText(valueOf(h.side))} °C, feels like`" :data-handle="h.side"
                aria-describedby="thermal-comfort-summary" @pointerdown="down(h.side, $event)" @keydown="key(h.side, $event)">
          <span class="dot" aria-hidden="true" />
        </button>
      </div>
      <AppIcon name="sun" class="end" aria-hidden="true" />
    </div>
    <div class="scale" aria-hidden="true"><span>{{ limitText(min) }}</span><span>0</span><span>{{ limitText(max) }} °C</span></div>
    <p id="thermal-comfort-summary" class="summary" aria-live="polite" data-testid="thermal-summary">{{ summary }}</p>
  </div>
</template>

<style scoped>
p { margin: 0; }
.thermal-comfort { display: flex; flex-direction: column; gap: var(--space-2); }
.card-head { display: flex; align-items: center; gap: var(--space-3); min-height: var(--touch); }
.card-head h3 { flex: 1; margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.link { border: 0; background: none; padding: var(--space-2) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; font-size: var(--fs-sm); }
.row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; }
.end { color: var(--text-2); }
.track { position: relative; height: var(--thermal-track-h); border-radius: var(--radius-pill); touch-action: none; }
.tick { position: absolute; top: 50%; width: var(--hairline); transform: translate(-50%, -50%); }
.tick.standard { height: calc(var(--thermal-track-h) + 2 * var(--space-2)); background: var(--text-muted); opacity: var(--inactive-opacity); }
.tick.mine { height: calc(var(--thermal-track-h) + 2 * var(--space-3)); width: var(--focus-width); background: var(--text); }
.handle {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: var(--touch-phone); height: var(--touch-phone); padding: 0; border: 0; background: transparent;
  display: grid; place-items: center; cursor: grab; touch-action: none; border-radius: 50%;
}
.handle:active { cursor: grabbing; }
.handle .dot {
  width: var(--handle-size); height: var(--handle-size); border-radius: 50%;
  background: var(--ring); border: var(--focus-width) solid var(--ring-edge); box-shadow: var(--photo-btn-shadow);
}
.handle:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: calc(-1 * var(--space-2)); }
.scale { display: flex; justify-content: space-between; padding: 0 calc(var(--icon) + var(--space-3)); font-size: var(--fs-xs); color: var(--text-muted); }
.summary { font-size: var(--fs-sm); color: var(--text-2); }
</style>
