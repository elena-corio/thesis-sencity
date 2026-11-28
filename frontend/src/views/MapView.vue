<script setup>
// Map view: the map with floating panels (brief §3, boards Flow 1, 1b, 1c; phone P1, P5).
// Fit every screen: panels are placed from the viewport and never overlap; the page never scrolls.
// Walk along a route (WalkView): its own panel over the map, under the top bar (on a phone, above the tab bar).
// Profile (ProfilePage): over the map, which stays as it was in Area or Routes and cannot be reached meanwhile; the
// onboarding takes the whole screen (boards 4, P4).
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import ProfilePage from '../components/ProfilePage.vue'
import AppLogo from '../components/AppLogo.vue'
import { useProfileStore } from '../stores/profile.js'
import { useAppTestStore } from '../stores/appTest.js'
import { useSensesStore } from '../stores/senses.js'
import { useWalkStore } from '../stores/walk.js'
import WalkView from '../components/WalkView.vue'
import AboutDialog from '../components/AboutDialog.vue'
import ReportView from '../components/ReportView.vue'
import { useReportStore } from '../stores/report.js'
import { useHelpStore } from '../stores/help.js'
import StepHint from '../components/StepHint.vue'
import TopActions from '../components/TopActions.vue'
import TopSearch from '../components/TopSearch.vue'
import ViewTabs from '../components/ViewTabs.vue'
import ChatPanel from '../components/ChatPanel.vue'
import { useChatStore } from '../stores/chat.js'

const area = useAreaStore()
const routes = useRoutesStore()
const senses = useSensesStore()
const walk = useWalkStore()
const help = useHelpStore()
const report = useReportStore()
const route = useRoute()
const sheetRef = ref(null)
const profile = useProfileStore()
const chat = useChatStore()
// With accounts (Elena, 2026-11-22): the account, its profile and ratings from the server, once per session; the
// privacy notice first if it was never agreed.
const router = useRouter()
onMounted(async () => {
  try {
    if (await profile.syncAccount() === 'notice') router.replace({ path: '/welcome', query: { notice: '1' } })
    else useAppTestStore().ensureLoaded() // for "Rate 8 places" in the account menu (fails quietly without an account)
  } catch {
    // The API could not be reached: the map still works; the profile loads on the next visit.
  }
})
const profileMode = computed(() => route.params.mode === 'profile')
// The map's own mode: Area or Routes, kept while Profile is open.
const mapMode = ref(route.params.mode === 'routes' ? 'routes' : 'area')
watch(() => route.params.mode, (m) => { if (m === 'area' || m === 'routes') mapMode.value = m })
const routesMode = computed(() => mapMode.value === 'routes')
// The onboarding is full screen; the profile itself keeps the tabs.
const onboarding = computed(() => profileMode.value && !!profile.survey && (!!profile.draft || profile.askingConsent))
// Going to the other view (Area or Routes) closes the walk or the enlarged photo.
watch(routesMode, () => { if (walk.active) walk.exit() })
const phone = useMedia('(max-width: 767px)')
const wide = useMedia('(min-width: 1200px)')
const mapRef = ref(null)

// Nothing asked for yet: Start, End and Analyse are in the left panel, the map hint says what to do.
const routeIdle = computed(() => !routes.hasResult && routes.load === 'idle')
// The right card only shows loading and results (a phone has one sheet instead of both panels).
const hasCard = computed(() => (routesMode.value ? !routeIdle.value : area.step === 'analysed'))
// Below 1200 px the right card replaces the left panel (brief §3, fit every screen).
// Routes keeps both: Start and End are always needed, and the two panels fit from 768 px up.
// No left panel in the walk (Elena, 2026-11-11): its key is in the right card.
const showLeft = computed(() => !phone.value && !walk.active && (routesMode.value || wide.value || !hasCard.value))
// The hint needs the space between the panels; below 1200 px the route card says the same.
const showHint = computed(() => !walk.active && (!routesMode.value || wide.value || routeIdle.value))

const loadingCard = computed(() => area.step === 'analysed' &&
  (area.load === 'loading' || area.load === 'error' || area.thermal === 'loading' || senses.areaRating))

const getCentre = () => mapRef.value?.getCentre() ?? null
const onPick = (place) => mapRef.value?.flyToPlace(place)
</script>

<template>
  <div class="app" :class="{ phone, wide, 'with-left': showLeft, 'with-card': hasCard, 'routes-mode': routesMode, walking: walk.active }">
    <MapCanvas ref="mapRef" :routes-mode="routesMode" :inert="profileMode" />

    <h1 class="visually-hidden">{{ profileMode ? 'SenCity: your sensory profile' : 'SenCity map' }}</h1>

    <template v-if="profileMode">
      <div class="slot" :class="onboarding ? 's-onboarding' : phone ? 's-p-profile' : 's-profile'"><ProfilePage :phone="phone" /></div>
      <template v-if="!onboarding">
        <div v-if="!phone" class="slot s-top-left">
          <RouterLink to="/area" class="logo-box panel" aria-label="SenCity, back to the map"><AppLogo /></RouterLink>
        </div>
        <div v-if="!phone" class="slot s-top-centre"><ViewTabs /></div>
        <div v-if="!phone" class="slot s-top-right"><TopActions /></div>
        <div v-else class="slot s-p-tabs"><ViewTabs phone /></div>
      </template>
    </template>

    <template v-else-if="!phone">
      <div class="slot s-top-left"><TopSearch :get-centre="getCentre" @pick="onPick" /></div>
      <div class="slot s-top-centre"><ViewTabs /></div>
      <div class="slot s-top-right"><TopActions /></div>
      <div v-if="showLeft" class="slot s-left">
        <RoutePanel v-if="routesMode" :get-centre="getCentre" @pick="onPick" />
        <LayerPanel v-else :get-centre="getCentre" @pick="onPick" />
      </div>
      <div v-if="showHint" class="slot s-hint"><StepHint :routes-mode="routesMode" /></div>
      <div v-if="walk.active" class="slot s-walk"><WalkView /></div>
      <!-- The chat (board 2) takes the right card's place while it is open. -->
      <div v-if="chat.open && !walk.active" class="slot s-card s-chat"><ChatPanel /></div>
      <div v-else-if="routesMode && !walk.active" class="slot s-card">
        <StretchCard v-if="routes.selectedStretch" />
        <RouteCard v-else-if="hasCard" />
      </div>
      <div v-else-if="!routesMode && !walk.active" class="slot s-card">
        <!-- A clicked street shows its card even while the area is loading ("you can keep exploring"). -->
        <PlaceCard v-if="area.selectedId" />
        <LoadingCard v-else-if="loadingCard" />
        <AreaCard v-else-if="hasCard" :controls="!showLeft" :get-centre="getCentre" @pick="onPick" />
      </div>
      <div v-if="!walk.active" class="slot s-controls">
        <MapControls @zoom-in="mapRef?.zoomIn()" @zoom-out="mapRef?.zoomOut()" @recentre="mapRef?.recentre()" />
      </div>
      <div class="slot s-attribution"><MapAttribution /></div>
    </template>

    <template v-else>
      <!-- Area and Routes alike: the search only moves the map; Start and End are typed in the sheet. -->
      <!-- While the chat is open it is the whole screen: the rest stays mounted, out of sight. -->
      <div v-show="!chat.open" class="slot s-p-top"><TopSearch phone :get-centre="getCentre" @pick="onPick" /></div>
      <div v-if="walk.active" v-show="!chat.open" class="slot s-p-walk"><WalkView phone /></div>
      <div v-else v-show="!chat.open" class="slot s-p-hint"><StepHint phone :routes-mode="routesMode" /></div>
      <div v-show="!walk.active && !chat.open" class="slot s-p-sheet">
        <PhoneSheet ref="sheetRef" :routes-mode="routesMode" :get-centre="getCentre" @pick="onPick" @recentre="mapRef?.recentre()"
                    @settled="mapRef?.reveal()" />
      </div>
      <div v-show="!chat.open" class="slot s-p-tabs"><ViewTabs phone /></div>
      <!-- The chat on a phone: the whole screen (brief §3). -->
      <div v-if="chat.open" class="slot s-p-chat"><ChatPanel phone /></div>
    </template>

    <!-- About and how to use: from "?", the account menu and every "How this works" link. -->
    <AboutDialog v-if="help.aboutOpen" :phone="phone" />
    <!-- The printable report: from the print icon, the account menu and Print area report. -->
    <ReportView v-if="report.open" />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  /* Never scrolled, not even by the browser bringing a focused field into view: that moved the whole onboarding up
     on a phone and left the bottom of the screen empty (Elena, 2026-11-15). */
  overflow: clip;
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
.s-p-chat { inset: 0; background: var(--ground); }
.s-p-chat > * { height: 100%; }
.s-chat { height: calc(100dvh - var(--row-main) - var(--row-bottom) - var(--controls-h) - var(--gap)); }

/* Profile (ProfilePage): under the top bar (on a phone, above the tab bar); the onboarding on the whole screen. */
.s-profile { inset: 0; padding-top: calc(var(--row-main) - var(--space-2)); background: var(--ground); }
.s-p-profile { top: 0; left: 0; right: 0; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); background: var(--ground); }
.s-onboarding { inset: 0; }
.logo-box { display: grid; place-items: center; width: var(--topbar-h); height: var(--topbar-h); color: var(--logo); }
.logo-box :deep(svg) { width: var(--logo-size); height: var(--logo-size); }
.s-profile > *, .s-p-profile > *, .s-onboarding > * { height: 100%; }

/* Walk (WalkView): one panel from under the top bar down to the credits; on a phone from under the search to the tab bar. */
.s-walk { top: var(--row-main); left: var(--margin); right: var(--margin); bottom: var(--row-bottom); }
.s-p-walk {
  top: calc(var(--margin) + var(--p-top-h) + var(--space-2)); left: 0; right: 0;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
}
</style>
