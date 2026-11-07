<script setup>
// Area inputs: Centre (address search) and Radius. Clicking on the map stays the default way; this is
// for typing. Closed it is one row ("Stephansplatz · 200 m"); hidden before anything is set unless the
// hint's "type an address" opened it. A city or district only moves the map; an address or a named
// place sets the centre. While the Centre field has the focus, the next map click sets the centre.
import { computed, ref, watch } from 'vue'
import config from '../config.js'
import { isAreaPlace } from '../lib/api.js'
import { formatCoords } from '../lib/geo.js'
import { useAreaStore } from '../stores/area.js'
import InputSection from './InputSection.vue'
import PlaceSearch from './PlaceSearch.vue'

const props = defineProps({
  /** Phone sheet: the section starts open, and the hints say "tap". */
  phone: Boolean,
  /** Makes the field id unique where two copies could exist. */
  idSuffix: { type: String, default: '' },
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pan', 'menu'])
const area = useAreaStore()

const fieldId = computed(() => `area-centre${props.idSuffix}-input`)
const expanded = ref(props.phone || area.inputsOpen)
watch(() => area.inputsOpen, (open) => { if (open) expanded.value = true })
const visible = computed(() => !!area.centre || area.inputsOpen || props.phone)
const placeholder = computed(() => `Search an address, or ${props.phone ? 'tap' : 'click on'} the map`)
const fallback = computed(() => (props.phone ? 'tap the map' : 'click on the map'))
const centreText = computed(() => (area.centre ? area.centreLabel || formatCoords(area.centre) : ''))
const summary = computed(() => (area.centre ? `${centreText.value} · ${area.radius} m` : 'Choose an area'))
/** 100, 200 and 500 m (config.radius.presets), plus the current radius when the mouse set another one. */
const radii = computed(() => [...new Set([...config.radius.presets, area.radius])].sort((a, b) => a - b))

function toggle() {
  expanded.value = !expanded.value
  if (!expanded.value) area.inputsOpen = false
}
function onPick(place) {
  if (isAreaPlace(place)) {
    emit('pan', place)
    return
  }
  area.setCentre(place, place.name)
  area.takeField() // the centre is set: a map click no longer moves it
}
function change() {
  area.reset()
  expanded.value = props.phone
}
</script>

<template>
  <InputSection v-if="visible" :summary="summary" :expanded="expanded" :can-change="!!area.centre"
                change-label="Change area: clear the centre and radius" @toggle="toggle" @change="change">
    <p class="field-label">Centre</p>
    <div class="field">
      <PlaceSearch :field-id="fieldId" label="Centre" :placeholder="placeholder"
                   :fallback="fallback" :value="centreText" :get-centre="getCentre"
                   @pick="onPick" @focus="area.armField('centre')" @blur="area.disarmField('centre')"
                   @open="emit('menu', $event)" />
    </div>
    <p class="field-label">Radius</p>
    <div class="radii" role="group" aria-label="Radius">
      <button v-for="r in radii" :key="r" type="button" class="chip" :class="{ on: area.radius === r }"
              :aria-pressed="area.radius === r" @click="area.setRadius(r)">{{ r }} m</button>
    </div>
  </InputSection>
</template>

<style scoped>
.field-label { margin: var(--space-3) 0 var(--space-1); font-size: var(--fs-sm); color: var(--text-2); }
.field-label:first-child { margin-top: 0; }
.field {
  position: relative; display: flex; align-items: center;
  min-height: var(--touch-phone); padding: 0 var(--space-1) 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: var(--ground);
}
.radii { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  min-height: var(--chip-h); padding: 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill);
  background: transparent; font-size: var(--fs-sm); font-variant-numeric: tabular-nums;
}
.chip.on { background: var(--btn-selected-bg); font-weight: var(--fw-semibold); }
@media (pointer: coarse) { .chip { min-height: var(--touch-phone); } }
</style>
