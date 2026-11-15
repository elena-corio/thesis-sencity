<script setup>
// "Temperature that feels comfortable to you" (Elena, 2026-11-15): feels-like °C from −20 to 40, a snowflake at the cold
// end and a sun at the hot end, so the direction reads without colour. The fill blends the map's comfort colours: hard
// (cold) → mixed → easy → mixed → hard (hot); easy is the person's comfortable range. Four ticks at their limits, the
// standard ones faint behind, so a shift shows. The start of cold and the start of hot are handles: drag them, or use
// the arrow keys (0.5 °C). Reset goes back to the weather answers. Local only: never in the profile text or a model call.
import { computed, ref } from 'vue'
import config from '../config.js'
import { comfortSummary, limitText, standardLimits, startRange, thermalBar } from '../lib/thermal.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  limits: { type: Object, required: true },
  /** A start was moved by hand: Reset works (it is shown either way). */
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
// The same bar as the place card's temperature bar (lib/thermal.js thermalBar, both sides): its colours and its labels.
const bar = computed(() => thermalBar(props.limits, 'both'))
const fill = computed(() => `linear-gradient(to right, ${bar.value.stops.map((s) => `var(--${s.state}) ${s.at}%`).join(', ')})`)
// The band borders under the bar; the scale's ends are written under the snowflake and the sun instead (Elena,
// 2026-11-15), so a border on an end (a limit moved all the way) is not written twice.
const labels = computed(() => bar.value.ticks.filter((tk) => tk.value > min && tk.value < max))
const summary = computed(() => comfortSummary(props.limits))
const HANDLES = [
  { side: 'cold', label: 'Start of cold' },
  { side: 'heat', label: 'Start of hot' },
]
const valueOf = (side) => (side === 'cold' ? props.limits.cold[0] : props.limits.heat[0])
/** Each start's range: its outer limit stays on the bar (lib/thermal.js startRange). */
const rangeOf = (side) => startRange(side, valueOf(side === 'heat' ? 'cold' : 'heat'))
// While a start is being moved (dragged, or a handle has the keyboard), the standard ticks are hidden: they confused
// (Elena, 2026-11-15). The summary line still names the standard range.
const adjusting = ref(false)

function fromPointer(e) {
  const r = track.value.getBoundingClientRect()
  return min + ((e.clientX - r.left) / r.width) * (max - min)
}
let dragging = null
function down(side, e) {
  dragging = side
  adjusting.value = true
  e.currentTarget.setPointerCapture?.(e.pointerId)
  e.currentTarget.focus()
}
function move(e) {
  if (dragging) emit('move', dragging, fromPointer(e))
}
function up() {
  dragging = null
  if (!track.value?.contains(document.activeElement)) adjusting.value = false
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
      <!-- Always there (Elena: it disappeared); it does something once a limit was moved by hand. -->
      <button type="button" class="link" :disabled="!moved" :title="moved ? 'Back to the values from your answers' : 'Already the values from your answers'"
              @click="emit('reset')">Reset</button>
    </div>
    <div class="row">
      <AppIcon name="snowflake" class="end" aria-hidden="true" />
      <div ref="track" class="track" :style="{ background: fill }" @pointermove="move" @pointerup="up" @pointercancel="up">
        <span v-for="t in stdTicks" v-show="!adjusting" :key="`s${t}`" class="tick standard" :style="{ left: pct(t) }" aria-hidden="true" />
        <span v-for="(t, i) in ticks" :key="`p${i}`" class="tick mine" :style="{ left: pct(t) }" aria-hidden="true" data-tick />
        <button v-for="h in HANDLES" :key="h.side" type="button" class="handle" :style="{ left: pct(valueOf(h.side)) }"
                role="slider" :aria-label="h.label" :aria-valuemin="rangeOf(h.side).min" :aria-valuemax="rangeOf(h.side).max" :aria-valuenow="valueOf(h.side)"
                :aria-valuetext="`${h.label}: ${limitText(valueOf(h.side))} °C, feels like`" :data-handle="h.side"
                aria-describedby="thermal-comfort-summary" @pointerdown="down(h.side, $event)" @keydown="key(h.side, $event)"
                @focus="adjusting = true" @blur="adjusting = false">
          <span class="diamond" aria-hidden="true" />
        </button>
      </div>
      <AppIcon name="sun" class="end" aria-hidden="true" />
      <!-- The scale's ends under the snowflake and the sun; the band borders in °C under their place on the bar. -->
      <span class="end-label" aria-hidden="true" data-end="cold">{{ limitText(min) }}</span>
      <div class="bar-ticks" aria-hidden="true">
        <span v-for="(tk, i) in labels" :key="i" :style="{ left: `${tk.at}%` }">{{ limitText(tk.value) }}</span>
      </div>
      <span class="end-label" aria-hidden="true" data-end="hot">{{ limitText(max) }} °C</span>
    </div>
    <p id="thermal-comfort-summary" class="summary" aria-live="polite" data-testid="thermal-summary">{{ summary }}</p>
  </div>
</template>

<style scoped>
p { margin: 0; }
.thermal-comfort { display: flex; flex-direction: column; gap: var(--space-2); }
.card-head { display: flex; align-items: center; gap: var(--space-3); min-height: var(--touch); }
.card-head h3 { flex: 1; margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.link { border: 0; background: none; padding: var(--space-2) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; font-size: var(--fs-sm); }
.link:disabled { opacity: var(--inactive-opacity); text-decoration: none; }
.row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: var(--space-3); padding-top: var(--space-2); }
.end { color: var(--text-2); justify-self: center; }
/* The place card's bar: thin, rounded, the comfort colours blending (PlaceCard .track). */
.track { position: relative; height: var(--swatch-h); border-radius: var(--radius-pill); touch-action: none; }
.tick { position: absolute; top: 50%; width: var(--hairline); transform: translate(-50%, -50%); }
.tick.standard { height: calc(var(--swatch-h) + 2 * var(--space-1)); background: var(--text-muted); opacity: var(--inactive-opacity); }
.tick.mine { height: calc(var(--swatch-h) + 2 * var(--space-2)); background: var(--text-2); }
.handle {
  position: absolute; top: 50%; transform: translate(-50%, -50%); z-index: 1;
  width: var(--touch-phone); height: var(--touch-phone); padding: 0; border: 0; background: transparent;
  display: grid; place-items: center; cursor: grab; touch-action: none;
}
.handle:active { cursor: grabbing; }
/* The place card's marker, a diamond. */
.handle .diamond {
  width: var(--handle-size); height: var(--handle-size); transform: rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
.handle:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: calc(-1 * var(--space-2)); border-radius: var(--radius-chip); }
.bar-ticks {
  grid-column: 2; position: relative; height: calc(var(--fs-xs) * var(--lh)); margin-top: var(--space-2);
  font-size: var(--fs-xs); color: var(--text-muted);
}
.bar-ticks span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; font-variant-numeric: tabular-nums; }
.end-label { justify-self: center; margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.summary { font-size: var(--fs-sm); color: var(--text-2); margin-top: var(--space-2); }
</style>
