<script setup>
// Walk inputs (desktop left panel, phone sheet): Start and End (address search), with a swap button.
// Clicking on the map stays the default way; this is for typing. Closed it is one row ("48.2097° N, 16.3708° E → …", or the names typed); hidden before anything
// is set unless the hint's "type an address" opened it. A city or district only moves the map; an
// address or a named place sets the point. While a field has the focus, the next map click fills it.
import { computed, ref, watch } from 'vue'
import config from '../config.js'
import { isAreaPlace } from '../lib/api.js'
import { formatKm, formatLength } from '../lib/routes.js'
import { useRoutesStore } from '../stores/routes.js'
import AnalyseAction from './AnalyseAction.vue'
import AppIcon from './AppIcon.vue'
import InputSection from './InputSection.vue'
import PlaceSearch from './PlaceSearch.vue'

const props = defineProps({
  /** Phone sheet: the section starts open, and the hints say "tap". */
  phone: Boolean,
  /** Makes the field ids unique where two copies could exist ("-phone" in the phone sheet). */
  idSuffix: { type: String, default: '' },
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pan', 'menu'])
const routes = useRoutesStore()

const expanded = ref(props.phone || routes.inputsOpen)
watch(() => routes.inputsOpen, (open) => { if (open) expanded.value = true })
const visible = computed(() => !!routes.start || !!routes.end || routes.inputsOpen || props.phone)
const placeholder = computed(() => `Search, or ${props.phone ? 'tap' : 'click on'} the map`)
const fallback = computed(() => (props.phone ? 'tap the map' : 'click on the map'))
const id = (which) => `route-${which}${props.idSuffix}-input`
const summary = computed(() => {
  if (!routes.start && !routes.end) return 'Choose a walk'
  return `${routes.start?.label ?? '…'} → ${routes.end?.label ?? '…'}`
})
const showAnalyse = computed(() => !routes.hasResult && routes.load === 'idle')
const note = computed(() => {
  if (!routes.previewing) return `Walking routes up to about ${formatKm(config.routes.maxM)}.`
  const { season, time } = routes.thermalWindow
  return `${formatLength(routes.aerialDistance)} in a straight line, thermal for ${season}, ${time}. Ready in a few minutes.`
})

function toggle() {
  expanded.value = !expanded.value
  if (!expanded.value) routes.inputsOpen = false
}
function onPick(which, place) {
  emit('pan', place)
  if (isAreaPlace(place)) return
  routes.setPoint(which, place, place.name, true)
  routes.takeField() // that field is done: the next map click fills the next empty one
}
function change() {
  routes.reset()
  expanded.value = props.phone
}
</script>

<template>
  <InputSection v-if="visible" icon="route" :summary="summary" :expanded="expanded" :can-change="!!(routes.start || routes.end)"
                change-label="Change walk: clear the start and end" @toggle="toggle" @change="change">
    <p class="field-label">Start</p>
    <div class="field">
      <PlaceSearch :field-id="id('start')" label="Start" :placeholder="placeholder"
                   :fallback="fallback" :value="routes.start?.label ?? ''" :get-centre="getCentre"
                   @pick="onPick('start', $event)" @clear="routes.clearPoint('start')" @open="emit('menu', $event)"
                   @focus="routes.armField('start')" @blur="routes.disarmField('start')" />
    </div>
    <p class="field-label">End</p>
    <div class="field">
      <PlaceSearch :field-id="id('end')" label="End" :placeholder="placeholder"
                   :fallback="fallback" :value="routes.end?.label ?? ''" :get-centre="getCentre"
                   @pick="onPick('end', $event)" @clear="routes.clearPoint('end')" @open="emit('menu', $event)"
                   @focus="routes.armField('end')" @blur="routes.disarmField('end')" @enter="routes.analyse(true)" />
    </div>
    <div class="under">
      <!-- Phone: the sheet covers the hint, so the reason shows here (desktop: in the hint). -->
      <p v-if="phone && routes.pointError" class="error" role="alert">{{ routes.pointError }}</p>
      <button type="button" class="btn swap" :disabled="!routes.start && !routes.end" @click="routes.swap()">
        <AppIcon name="swap" /> Swap start and end
      </button>
    </div>
    <template #action>
      <AnalyseAction v-if="showAnalyse" label="Analyse the routes" :note="note" :ready="routes.previewing"
                     :by-keyboard="routes.byKeyboard" @analyse="routes.analyse" />
    </template>
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
.under { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-2); }
.error { flex: 1 1 100%; margin: 0; font-size: var(--fs-sm); color: var(--text); }
.swap { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--touch); margin-left: auto; font-size: var(--fs-sm); }
.swap:disabled { opacity: var(--inactive-opacity); }
@media (pointer: coarse) { .swap { min-height: var(--touch-phone); } }
</style>
