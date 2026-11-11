<script setup>
// Map view: the map with floating panels (brief §3, boards Flow 1, 1b, 1c; phone P1, P5).
// Fit every screen: panels are placed from the viewport and never overlap; the page never scrolls.
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMedia } from '../composables.js'
import { useAreaStore } from '../stores/area.js'
import { useRoutesStore } from '../stores/routes.js'
import AreaCard from '../components/AreaCard.vue'
import LoadingCard from '../components/LoadingCard.vue'
import PlaceCard from '../components/PlaceCard.vue'
import RouteCard from '../components/RouteCard.vue'
import RoutePanel from '../components/RoutePanel.vue'
import StretchCard from '../components/StretchCard.vue'
import LayerPanel from '../components/LayerPanel.vue'
import MapAttribution from '../components/MapAttribution.vue'
import MapCanvas from '../components/MapCanvas.vue'
import MapControls from '../components/MapControls.vue'
import PhoneSheet from '../components/PhoneSheet.vue'
import { useSensesStore } from '../stores/senses.js'
import StepHint from '../components/StepHint.vue'
import TopActions from '../components/TopActions.vue'
import TopSearch from '../components/TopSearch.vue'
import ViewTabs from '../components/ViewTabs.vue'

const area = useAreaStore()
const routes = useRoutesStore()
const senses = useSensesStore()
const route = useRoute()
const routesMode = computed(() => route.params.mode === 'routes')
const phone = useMedia('(max-width: 767px)')
const wide = useMedia('(min-width: 1200px)')
const mapRef = ref(null)

// Nothing asked for yet: Start, End and Analyse are in the left panel, the map hint says what to do.
const routeIdle = computed(() => !routes.hasResult && routes.load === 'idle')
// The right card only shows loading and results (a phone has one sheet instead of both panels).
const hasCard = computed(() => (routesMode.value ? !routeIdle.value : area.step === 'analysed'))
// Below 1200 px the right card replaces the left panel (brief §3, fit every screen).
// Routes keeps both: Start and End are always needed, and the two panels fit from 768 px up.
const showLeft = computed(() => !phone.value && (routesMode.value || wide.value || !hasCard.value))
// The hint needs the space between the panels; below 1200 px the route card says the same.
const showHint = computed(() => !routesMode.value || wide.value || routeIdle.value)

const loadingCard = computed(() => area.step === 'analysed' &&
  (area.load === 'loading' || area.load === 'error' || area.thermal === 'loading' || senses.areaRating))

const getCentre = () => mapRef.value?.getCentre() ?? null
const onPick = (place) => mapRef.value?.flyToPlace(place)
</script>

<template>
  <div class="app" :class="{ phone, wide, 'with-left': showLeft, 'with-card': hasCard, 'routes-mode': routesMode }">
    <MapCanvas ref="mapRef" :routes-mode="routesMode" />

    <h1 class="visually-hidden">SenCity map</h1>

    <template v-if="!phone">
      <div class="slot s-top-left"><TopSearch :get-centre="getCentre" @pick="onPick" /></div>
      <div class="slot s-top-centre"><ViewTabs /></div>
      <div class="slot s-top-right"><TopActions /></div>
      <div v-if="showLeft" class="slot s-left">
        <RoutePanel v-if="routesMode" :get-centre="getCentre" @pick="onPick" />
        <LayerPanel v-else :get-centre="getCentre" @pick="onPick" />
      </div>
      <div v-if="showHint" class="slot s-hint"><StepHint :routes-mode="routesMode" /></div>
      <div v-if="routesMode" class="slot s-card">
        <StretchCard v-if="routes.selectedStretch" />
        <RouteCard v-else-if="hasCard" />
      </div>
      <div v-else class="slot s-card">
        <!-- A clicked street shows its card even while the area is loading ("you can keep exploring"). -->
        <PlaceCard v-if="area.selectedId" />
        <LoadingCard v-else-if="loadingCard" />
        <AreaCard v-else-if="hasCard" :controls="!showLeft" :get-centre="getCentre" @pick="onPick" />
      </div>
      <div class="slot s-controls">
        <MapControls @zoom-in="mapRef?.zoomIn()" @zoom-out="mapRef?.zoomOut()" @recentre="mapRef?.recentre()" />
      </div>
      <div class="slot s-attribution"><MapAttribution /></div>
    </template>

    <template v-else>
      <!-- Area and Routes alike: the search only moves the map; Start and End are typed in the sheet. -->
      <div class="slot s-p-top"><TopSearch phone :get-centre="getCentre" @pick="onPick" /></div>
      <div class="slot s-p-hint"><StepHint phone :routes-mode="routesMode" /></div>
      <div class="slot s-p-sheet">
        <PhoneSheet :routes-mode="routesMode" :get-centre="getCentre" @pick="onPick" @recentre="mapRef?.recentre()"
                    @settled="mapRef?.reveal()" />
      </div>
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
  /* The left panel reaches down to the bottom row (the season bar that used to sit there is gone). */
  --main-bottom: var(--row-bottom);
  --reserve-left: calc(var(--margin) + var(--panel-left-w) + var(--gap));
  --reserve-right: calc(var(--margin) + var(--panel-right-w) + var(--gap));
  --p-top-h: var(--topbar-h);
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

.s-controls { bottom: var(--row-bottom); right: var(--margin); }
.s-attribution { bottom: var(--space-1); left: var(--margin); max-width: calc(100vw - 2 * var(--margin) - var(--control-size) - var(--space-2) - var(--gap)); }


/* Phone (board P1) */
.s-p-top { top: var(--margin); left: var(--margin); right: var(--margin); }
.s-p-hint {
  top: calc(var(--margin) + var(--p-top-h) + var(--gap));
  left: var(--margin); right: var(--margin);
  display: flex; justify-content: center;
}
.s-p-hint > * { max-width: 100%; }

.s-p-sheet {
  left: 0; right: 0;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
}
.s-p-tabs { left: 0; right: 0; bottom: 0; }
</style>
