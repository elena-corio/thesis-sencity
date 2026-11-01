<script setup>
// Map view: the map with floating panels (brief §3, boards Flow 1, 1b, 1c; phone P1, P5).
// Fit every screen: panels are placed from the viewport and never overlap; the page never scrolls.
import { computed, ref } from 'vue'
import { useMedia } from '../composables.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from '../components/AppIcon.vue'
import AreaCard from '../components/AreaCard.vue'
import LayerPanel from '../components/LayerPanel.vue'
import MapAttribution from '../components/MapAttribution.vue'
import MapCanvas from '../components/MapCanvas.vue'
import MapControls from '../components/MapControls.vue'
import SeasonBar from '../components/SeasonBar.vue'
import StepHint from '../components/StepHint.vue'
import TopActions from '../components/TopActions.vue'
import TopSearch from '../components/TopSearch.vue'
import ViewTabs from '../components/ViewTabs.vue'

const area = useAreaStore()
const phone = useMedia('(max-width: 767px)')
const wide = useMedia('(min-width: 1200px)')
const mapRef = ref(null)

const hasCard = computed(() => area.step === 'set' || area.step === 'analysed')
// Below 1200 px the right card replaces the left panel (brief §3, fit every screen).
const showLeft = computed(() => !phone.value && (wide.value || !hasCard.value))

const getCentre = () => mapRef.value?.getCentre() ?? null
const onPick = (place) => mapRef.value?.flyToPlace(place)
</script>

<template>
  <div class="app" :class="{ phone, wide, 'with-left': showLeft, 'with-card': hasCard }">
    <MapCanvas ref="mapRef" />

    <h1 class="visually-hidden">SenCity map</h1>

    <template v-if="!phone">
      <div class="slot s-top-left"><TopSearch :get-centre="getCentre" @pick="onPick" /></div>
      <div class="slot s-top-centre"><ViewTabs /></div>
      <div class="slot s-top-right"><TopActions /></div>
      <div v-if="showLeft" class="slot s-left"><LayerPanel /></div>
      <div class="slot s-hint"><StepHint /></div>
      <div class="slot s-card"><AreaCard @focus-map="mapRef?.focusMap()" /></div>
      <div class="slot s-season"><SeasonBar /></div>
      <div class="slot s-controls">
        <MapControls @zoom-in="mapRef?.zoomIn()" @zoom-out="mapRef?.zoomOut()" @recentre="mapRef?.recentre()" />
      </div>
      <div class="slot s-attribution"><MapAttribution /></div>
    </template>

    <template v-else>
      <div class="slot s-p-top"><TopSearch phone :get-centre="getCentre" @pick="onPick" /></div>
      <div class="slot s-p-row">
        <SeasonBar phone />
        <button type="button" class="ask-round" aria-label="Ask" aria-disabled="true" title="Coming soon" data-panel="ask">
          <AppIcon name="chat" />
        </button>
      </div>
      <div v-if="!hasCard" class="slot s-p-hint"><StepHint phone /></div>
      <div class="slot s-p-sheet">
        <AreaCard phone @focus-map="mapRef?.focusMap()">
          <MapAttribution class="in-sheet" in-sheet />
        </AreaCard>
      </div>
      <div v-if="!hasCard" class="slot s-p-attribution"><MapAttribution /></div>
      <div class="slot s-p-tabs"><ViewTabs phone /></div>
    </template>
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  /* Rows of the floating layout */
  --row-top: var(--margin);
  --row-main: calc(var(--margin) + var(--topbar-h) + var(--gap));
  /* Bottom row (season bar, map controls) stays above the credits line. */
  --row-bottom: max(var(--space-5), calc(2 * var(--space-1) + var(--attribution-h)));
  --main-bottom: calc(var(--row-bottom) + var(--topbar-h) + var(--gap));
  --reserve-left: calc(var(--margin) + var(--panel-left-w) + var(--gap));
  --reserve-right: calc(var(--margin) + var(--panel-right-w) + var(--gap));
}
.slot { position: absolute; pointer-events: none; }
.slot > * { pointer-events: auto; }

/* Desktop and tablet */
.s-top-left { top: var(--row-top); left: var(--margin); width: var(--panel-left-w); max-width: calc(50vw - var(--tabs-half) - var(--margin) - var(--gap)); }
.s-top-centre { top: var(--row-top); left: 50%; transform: translateX(-50%); }
.s-top-right { top: var(--row-top); right: var(--margin); }

.s-left {
  top: var(--row-main); left: var(--margin); width: var(--panel-left-w);
  max-height: calc(100dvh - var(--row-main) - var(--main-bottom));
  display: flex;
}
.s-left > * { max-height: 100%; width: 100%; }

.s-hint {
  top: var(--row-main);
  left: var(--margin); right: var(--margin);
  display: flex; justify-content: center;
}
.with-left .s-hint { left: var(--reserve-left); }
.with-card .s-hint { right: var(--reserve-right); }
/* Wide screens: keep the hint centred on the viewport, as on the boards. */
.wide .s-hint { left: var(--reserve-right); right: var(--reserve-right); }
.s-hint > * { max-width: 100%; }

.s-card {
  top: var(--row-main); right: var(--margin); width: var(--panel-right-w);
  max-height: calc(100dvh - var(--row-main) - var(--row-bottom) - var(--controls-h) - var(--gap));
  display: flex;
}
.s-card > * { max-height: 100%; width: 100%; }

.s-season {
  bottom: var(--row-bottom); left: 50%; transform: translateX(-50%);
  width: min(var(--seasonbar-w), calc(100vw - 2 * (var(--margin) + var(--control-size) + var(--space-2) + var(--gap))));
}
.s-season > * { width: 100%; }
.s-controls { bottom: var(--row-bottom); right: var(--margin); }
.s-attribution { bottom: var(--space-1); left: var(--margin); max-width: calc(100vw - 2 * var(--margin) - var(--control-size) - var(--space-2) - var(--gap)); }


/* Phone (board P1) */
.s-p-top { top: var(--margin); left: var(--margin); right: var(--margin); }
.s-p-row {
  top: calc(var(--margin) + var(--topbar-h) + var(--gap));
  left: var(--margin); right: var(--margin);
  display: flex; gap: var(--gap);
}
.ask-round {
  width: var(--touch-phone); height: var(--touch-phone); flex: none;
  display: grid; place-items: center;
  border: 0; border-radius: var(--radius-btn);
  background: var(--btn-primary-bg); color: var(--btn-primary-text);
}
.s-p-hint {
  top: calc(var(--margin) + var(--topbar-h) + var(--gap) + var(--touch-phone) + var(--gap));
  left: var(--margin); right: var(--margin);
  display: flex; justify-content: center;
}
.s-p-hint > * { max-width: 100%; }
.s-p-sheet {
  left: 0; right: 0;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  /* The sheet starts below the season row (the hint gives way to the sheet on a phone). */
  max-height: calc(100dvh - var(--tabbar-h) - env(safe-area-inset-bottom) - var(--p-row-bottom));
  display: flex;
  --p-row-bottom: calc(var(--margin) + var(--topbar-h) + 2 * var(--gap) + var(--touch-phone));
}
.s-p-sheet > * { width: 100%; max-height: 100%; }
.in-sheet { margin-top: var(--space-3); }
.s-p-attribution { left: var(--margin); right: var(--margin); bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--space-1)); }
.s-p-tabs { left: 0; right: 0; bottom: 0; }
</style>
