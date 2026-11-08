<script setup>
// The one bottom sheet on a phone (boards P1, P1b, P1c, P2, P3): the tabs Settings (the desktop left panel)
// and Results (the desktop right card), minimised or open at one fixed height, where long content scrolls.
// The legend and the map credits float just above its top edge and move with it. Analyse leads to Results, a tapped street to its card, and Change or
// "type an address" to the open fields; otherwise the tab the person chose stays.
import { computed, nextTick, ref, useId, watch } from 'vue'
import config from '../config.js'
import { useAreaStore } from '../stores/area.js'
import { useRoutesStore } from '../stores/routes.js'
import AppIcon from './AppIcon.vue'
import AreaCard from './AreaCard.vue'
import LayerLegend from './LayerLegend.vue'
import LayerPanel from './LayerPanel.vue'
import LoadingCard from './LoadingCard.vue'
import MapAttribution from './MapAttribution.vue'
import PlaceCard from './PlaceCard.vue'
import RouteCard from './RouteCard.vue'
import RoutePanel from './RoutePanel.vue'
import StretchCard from './StretchCard.vue'

const props = defineProps({
  routesMode: Boolean,
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick', 'recentre', 'settled'])
const area = useAreaStore()
const routes = useRoutesStore()
const uid = useId()

const TABS = [{ id: 'settings', label: 'Settings' }, { id: 'results', label: 'Results' }]
const routeIdle = computed(() => !routes.hasResult && routes.load === 'idle')
const hasResults = computed(() => (props.routesMode ? !routeIdle.value : area.step === 'analysed'))
const pending = computed(() => (props.routesMode ? routes.previewing : area.step === 'set'))
const areaLoading = computed(() => area.step === 'analysed' &&
  (area.load === 'loading' || area.load === 'error' || area.thermal === 'loading'))

const tab = ref('settings')
const size = ref('min')
const dragHeight = ref(null)
const root = ref(null)
const panels = ref({})
const open = computed(() => size.value !== 'min')

function fromState() {
  tab.value = hasResults.value ? 'results' : 'settings'
  size.value = hasResults.value || pending.value ? 'open' : 'min'
}
fromState()
watch(() => props.routesMode, fromState)

function show(which) {
  tab.value = which
  size.value = 'open'
}

// Automatic switching.
watch(() => area.step, (step) => {
  if (props.routesMode) return
  if (step === 'analysed') show('results')
  else if (step === 'set') show('settings')
})
watch(() => area.selectedId, (id) => { if (id) show('results') })
watch(() => area.inputsOpen, (on) => { if (on) show('settings') })
watch(() => routes.previewing, (on) => { if (on) show('settings') })
watch(() => routes.load, (load) => { if (load === 'loading' && !routes.hasResult) show('results') })
watch(() => routes.selected?.key, (key) => { if (key) show('results') })
watch(() => routes.inputsOpen, (on) => { if (on) show('settings') })

// The map keeps its content in view when the sheet changes height or the legend appears above it.
let settleTimer
function settleSoon() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => emit('settled'), config.sheetSettleMs)
}
// Focus comes into the sheet when it opens.
watch(size, async (now) => {
  settleSoon()
  if (now === 'min') {
    // So that "type an address" counts as opening the fields again.
    area.inputsOpen = false
    routes.inputsOpen = false
    return
  }
  await nextTick()
  if (!root.value?.contains(document.activeElement)) panels.value[tab.value]?.focus({ preventScroll: true })
})

function choose(id) {
  tab.value = id
  size.value = 'open'
}
function toggle() {
  size.value = open.value ? 'min' : 'open'
}
function onTabKey(e) {
  const i = TABS.findIndex((t) => t.id === tab.value)
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key]
  if (next == null) return
  e.preventDefault()
  tab.value = TABS[(next + TABS.length) % TABS.length].id
  nextTick(() => root.value?.querySelector('[role="tab"][aria-selected="true"]')?.focus())
}

// Dragging the top of the sheet: a short drag is a tap; a longer one opens or minimises it.
// Followed on the window, as the pointer soon leaves the top of the sheet.
let drag = null
let justDragged = false
function onDown(e) {
  if (e.button !== 0) return
  drag = { y: e.clientY, height: root.value.offsetHeight, moved: false }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
function onMove(e) {
  const dy = drag.y - e.clientY
  if (!drag.moved && Math.abs(dy) < config.sheetDrag.startPx) return
  drag.moved = true
  dragHeight.value = drag.height + dy
}
function onUp(e) {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
  const { y, moved } = drag
  drag = null
  dragHeight.value = null
  if (!moved || e.type === 'pointercancel') return
  // The click that ends a drag is not a tap on a tab.
  justDragged = true
  setTimeout(() => { justDragged = false }, 50)
  const dy = y - e.clientY
  if (Math.abs(dy) >= config.sheetDrag.minPx) size.value = dy > 0 ? 'open' : 'min'
}

function onHeadClick(e) {
  if (justDragged) e.stopPropagation()
}

const showLegend = computed(() => (props.routesMode ? routes.hasResult : area.legendReady))
watch(showLegend, settleSoon)
const legendLayer = computed(() => (props.routesMode ? routes.layer : area.layer))
const settingsLine = computed(() => {
  const name = legendLayer.value[0].toUpperCase() + legendLayer.value.slice(1)
  if (legendLayer.value === 'senses') return name
  const { season, time } = (props.routesMode ? routes : area).thermalWindow
  return `${name} · ${season} ${time}`
})
const resultsLine = computed(() => {
  if (props.routesMode) {
    if (routes.load === 'loading') return 'Loading…'
    if (!routes.hasResult) return 'Nothing yet'
    const easiest = routes.shown.find((r) => r.kind === 'easiest') ?? routes.shown[0]
    return `Route ${easiest.id} easiest`
  }
  if (area.step !== 'analysed') return 'Nothing yet'
  if (areaLoading.value) return 'Loading…'
  const n = area.markers.length
  return n ? `${n} suggestion${n > 1 ? 's' : ''}` : `${area.counts.all} street stretches`
})
const lines = computed(() => ({ settings: settingsLine.value, results: resultsLine.value }))
</script>

<template>
  <section ref="root" class="phone-sheet panel" :class="[size, { dragging: dragHeight !== null }]" data-panel="sheet" data-scrollable
           aria-label="Settings and results" :style="dragHeight !== null ? { height: `${dragHeight}px` } : null">
    <div class="floating">
      <MapAttribution in-sheet />
      <div v-if="showLegend" class="strip panel" data-panel="legend" role="group" aria-label="Legend">
        <LayerLegend :layer="legendLayer" compact />
      </div>
    </div>

    <div class="head" @pointerdown="onDown" @click.capture="onHeadClick">
      <div class="grip" aria-hidden="true" />
      <div class="tab-row" :class="{ open }">
        <div class="tabs" role="tablist" aria-label="Settings and results" @keydown="onTabKey">
          <button v-for="t in TABS" :id="`${uid}-tab-${t.id}`" :key="t.id" type="button" role="tab" class="tab"
                  :class="{ on: tab === t.id }" :aria-selected="tab === t.id" :aria-controls="`${uid}-panel-${t.id}`"
                  :tabindex="tab === t.id ? 0 : -1" @click="choose(t.id)">
            <span class="tab-name">{{ t.label }}</span>
            <span v-if="!open" class="tab-line">{{ lines[t.id] }}</span>
          </button>
        </div>
        <button type="button" class="icon-btn toggle" :aria-label="open ? 'Minimise' : 'Open the sheet'" :aria-expanded="open"
                @click="toggle">
          <AppIcon :name="open ? 'chevronDown' : 'chevronUp'" />
        </button>
      </div>
    </div>

    <div v-show="open" class="body">
      <div v-show="tab === 'settings'" :id="`${uid}-panel-settings`" :ref="(el) => { panels.settings = el }" class="tabpanel"
           role="tabpanel" tabindex="-1" :aria-labelledby="`${uid}-tab-settings`">
        <RoutePanel v-if="routesMode" phone :get-centre="getCentre" @pick="emit('pick', $event)" />
        <LayerPanel v-else phone :get-centre="getCentre" @pick="emit('pick', $event)" />
      </div>
      <div v-show="tab === 'results'" :id="`${uid}-panel-results`" :ref="(el) => { panels.results = el }" class="tabpanel"
           role="tabpanel" tabindex="-1" :aria-labelledby="`${uid}-tab-results`">
        <template v-if="routesMode">
          <StretchCard v-if="routes.selectedStretch" phone />
          <RouteCard v-else-if="hasResults" phone />
          <p v-else class="empty">Results appear here after Analyse.</p>
        </template>
        <template v-else>
          <PlaceCard v-if="area.selectedId" phone />
          <LoadingCard v-else-if="areaLoading" phone />
          <AreaCard v-else-if="hasResults" phone @recentre="emit('recentre')" />
          <p v-else class="empty">Results appear here after Analyse.</p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Not ".sheet": the cards inside use that name, and a scoped style would reach their root element too. */
.phone-sheet {
  /* Room for the top bar and the strip above the sheet, on any screen. */
  --sheet-room: calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom) - var(--margin) - var(--topbar-h) - var(--gap) - var(--sheet-above));
  --sheet-open-h: min(var(--sheet-open), var(--sheet-room));
  position: relative; display: flex; flex-direction: column;
  min-height: var(--sheet-min); max-height: var(--sheet-open-h);
  border-bottom: 0; border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  box-shadow: none; transition: height var(--transition);
}
.min { height: var(--sheet-min); }
.phone-sheet.open { height: var(--sheet-open-h); }
.dragging { transition: none; }

/* Floats over the map, which stays usable behind it. */
.floating {
  position: absolute; left: var(--margin); right: var(--margin); bottom: calc(100% + var(--space-2));
  display: flex; flex-direction: column; gap: var(--space-1); pointer-events: none;
}
.floating :deep(a) { pointer-events: auto; }
.strip { padding: var(--space-2) var(--space-3); }

.head { flex: none; padding: var(--space-2) var(--space-4) 0; touch-action: none; }
.grip { width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-1); border-radius: var(--radius-pill); background: var(--line); }
.tab-row { display: flex; align-items: center; gap: var(--space-2); }
.tab-row.open { border-bottom: var(--hairline) solid var(--line); }
.tabs { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; }
.tab {
  display: flex; flex-direction: column; justify-content: center; min-width: 0; min-height: var(--touch-phone);
  padding: 0 var(--space-1); border: 0; border-bottom: var(--focus-width) solid transparent;
  background: transparent; color: var(--text-2);
}
/* Minimised: Settings as wide as its line needs, so both lines fit. */
.tab-row:not(.open) .tabs { grid-template-columns: minmax(0, max-content) minmax(0, 1fr); column-gap: var(--space-4); }
.tab-row:not(.open) .tab { padding: 0; text-align: left; }
.open .tab { align-items: center; }
.tab:not(.on) { font-weight: var(--fw-regular); }
.tab.on { border-bottom-color: var(--text); color: var(--text); font-weight: var(--fw-semibold); }
.tab-name { font-size: var(--fs-md); }
.tab-line {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--fs-xs); font-weight: var(--fw-regular); color: var(--text-2);
}
.toggle { flex: none; width: var(--touch-phone); height: var(--touch-phone); }

.body { flex: 1; min-height: 0; display: flex; }
.tabpanel {
  flex: 1; min-width: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: var(--space-3) var(--space-4) var(--space-5);
}
.empty { margin: 0; color: var(--text-2); }
</style>
