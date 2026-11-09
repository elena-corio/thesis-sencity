<script setup>
// Place card (boards 2f, 2g; phone P2): the selected segment's photo and name. On the Thermal layer
// (board 2e) the photo stays (Elena's choice) and the rest is thermal comfort only: how warm or cold it
// feels, the state and why, a temperature bar (the legend's side) and a cooler (or warmer) street nearby.
// On the Senses layer the photo on the card goes to the model (board 2c, SensesPrediction).
// Images load only now, on click: the current photo, and the others of this street (at most 3,
// so the previous and next ones) for the thumbnails. The same URL is reused, so each loads once.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { photoUrl } from '../lib/api.js'
import { formatMonth } from '../lib/geo.js'
import { easierThermalNearby } from '../lib/nearby.js'
import { credit, nearestWithPhotos, photoLine, sizeLabel, typeLabel } from '../lib/place.js'
import { barLabel, barPosition, formatDegrees, isCold, thermalBar, thermalLimits, thermalSide, thermalVerdict, walkMinutes } from '../lib/thermal.js'
import { comfortLabel } from '../lib/senses.js'
import { useAreaStore } from '../stores/area.js'
import { useSensesStore } from '../stores/senses.js'
import AppIcon from './AppIcon.vue'
import PhotoViewer from './PhotoViewer.vue'
import SensesPrediction from './SensesPrediction.vue'

const props = defineProps({
  phone: Boolean,
  /** What the card shows, when it is not the street selected on the map: a stretch of a route (brief §3,
   *  "one card pattern"). { key, feature, layer, info, features, backLabel, subtitle, byKeyboard, back(keyboard) } */
  source: { type: Object, default: null },
})
const area = useAreaStore()
// The street selected on the map.
const fromArea = computed(() => ({
  key: area.selectedId,
  feature: area.selected,
  layer: area.layer,
  info: area.thermalInfo,
  features: area.segments?.features ?? [],
  backLabel: 'Back to area',
  subtitle: null,
  byKeyboard: area.byKeyboard,
  back: () => area.clearSelection(),
}))
const src = computed(() => props.source ?? fromArea.value)
const backBtn = ref(null)
const fromBtn = ref(null)
const enlargeBtn = ref(null)
const senses = useSensesStore()
/** Reopening a street in Senses shows the photo already asked about, so it is not asked about another. */
function askedIndex() {
  const asked = senses.forSegment(src.value.key)?.photo
  const list = src.value.feature?.properties.photos ?? []
  return asked ? Math.max(0, list.findIndex((ph) => ph.pano_id === asked.pano_id && ph.heading === asked.heading)) : 0
}
const index = ref(askedIndex())
const viewerOpen = ref(false)
const failed = ref(new Set())

const feature = computed(() => src.value.feature)
const p = computed(() => feature.value?.properties)
const photos = computed(() => p.value?.photos ?? [])
const photo = computed(() => photos.value[index.value])
const type = computed(() => (feature.value ? typeLabel(p.value, feature.value.geometry.type) : ''))
const dates = computed(() => [...new Set(photos.value.map((ph) => formatMonth(ph.date)))].join(', '))
const STATE_LABEL = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }
const thermalView = computed(() => src.value.layer === 'thermal' && p.value?.utci != null)
// The thermal limits this card rates with (the standard ones, "Thermal · general"); the nearby street
// and the map suggestions use the same.
const limits = computed(() => thermalLimits())
// Too cold: the nearby street is then a warmer one, otherwise (too warm) a cooler one.
const cold = computed(() => thermalView.value && isCold(p.value.utci, limits.value))
/** "Hard: above 32 °C", only the side that applies. */
const verdict = computed(() => thermalView.value && thermalVerdict(p.value.utci, limits.value))
/** The temperature bar follows the legend's side rule, from the values on screen (the area or the routes). */
const side = computed(() => thermalSide((src.value.features ?? []).map((f) => f.properties.utci).filter((v) => v != null), limits.value))
const bar = computed(() => thermalBar(limits.value, side.value))
const gradient = computed(() =>
  `linear-gradient(to right, ${bar.value.stops.map((s) => `var(--${s.state}) ${s.at}%`).join(', ')})`)
const deg = (v) => `${String(v).replace('-', '−')}`
/** "Cooler street nearby": a street within a short walk, at least one level better (lib/nearby.js).
 *  Only for a street selected on the map, since following it selects that street on the map. */
const better = computed(() => {
  if (props.source || !thermalView.value) return null
  return easierThermalNearby(feature.value, src.value.features, limits.value)
})
const betterLabel = computed(() => better.value &&
  `Go to ${better.value.f.properties.name}, ${walkMinutes(better.value.d)} min away, ${formatDegrees(better.value.f.properties.utci)}`)
const cameFrom = computed(() => (!props.source && area.cameFrom?.id !== area.selectedId ? area.cameFrom : null))
const alongWord = computed(() => (feature.value?.geometry.type === 'Polygon' ? 'in this place' : 'along this street'))

watch(() => src.value.key, () => {
  index.value = askedIndex()
  failed.value = new Set()
})

// Senses mode: the photo on the card goes to the model, for a street selected on the map (not a route stretch).
const sensesOn = computed(() => !props.source && src.value.layer === 'senses')
const sensesEntry = computed(() => (sensesOn.value && photo.value ? senses.forSegment(p.value.id) : null))
const viewerRating = computed(() => (sensesEntry.value?.status === 'ready' ? `${comfortLabel(sensesEntry.value.result.comfort)}, this photo` : 'Not rated yet'))
watch(() => [sensesOn.value, p.value?.id, photo.value?.pano_id, photo.value?.heading], () => {
  if (sensesOn.value && photo.value) senses.ask(p.value.id, p.value.name, photo.value, area.selectedPoint)
}, { immediate: true })

function step(d) {
  const n = photos.value.length
  if (n > 1) index.value = (index.value + d + n) % n
}

function openViewer() {
  if (photo.value) viewerOpen.value = true
}
function closeViewer() {
  viewerOpen.value = false
  nextTick(() => enlargeBtn.value?.focus())
}

function goNearest() {
  const near = nearestWithPhotos(feature.value, src.value.features)
  if (near) area.select(near.f.properties.id, near.mid)
}

function onImgError(i) {
  failed.value = new Set([...failed.value, i])
}

// Opened with the keyboard: focus starts on "Back to <street>" after a nearby link, else "Back to area".
const focusStart = () => (fromBtn.value ?? backBtn.value)?.focus()
onMounted(() => { if (src.value.byKeyboard) focusStart() })
watch(() => src.value.key, () => { if (src.value.byKeyboard && !props.source) nextTick(focusStart) })
</script>

<template>
  <section v-if="feature" class="card panel" :class="{ sheet: props.phone }" data-panel="place-card" data-scrollable
           aria-labelledby="place-title">
    <button ref="backBtn" type="button" class="back" @click="src.back($event.detail === 0)">
      <AppIcon name="chevronLeft" /> {{ src.backLabel }}
    </button>
    <button v-if="cameFrom" ref="fromBtn" type="button" class="back from" @click="area.goBack($event.detail === 0)">
      <AppIcon name="chevronLeft" /> <span>Back to <span lang="de">{{ cameFrom.name }}</span></span>
    </button>
    <slot name="head" />

    <div class="top">
      <div v-if="photo" class="photo">
        <button type="button" class="photo-open" :aria-label="`Enlarge photo ${index + 1} of ${photos.length}`"
                @click="openViewer">
          <img v-if="!failed.has(index)" :src="photoUrl(photo)" :alt="`Street photo of ${p.name}, ${photoLine(photo)}`"
               @error="onImgError(index)" />
          <span v-else class="img-failed">The photo could not be loaded.</span>
        </button>
        <button ref="enlargeBtn" type="button" class="badge enlarge" aria-label="Enlarge photo" @click="openViewer">
          <AppIcon name="expand" />
        </button>
        <template v-if="photos.length > 1">
          <button type="button" class="arrow prev" aria-label="Previous photo" @click="step(-1)">
            <AppIcon name="chevronLeft" />
          </button>
          <button type="button" class="arrow next" aria-label="Next photo" @click="step(1)">
            <AppIcon name="chevronRight" />
          </button>
        </template>
        <span class="counter">{{ index + 1 }} / {{ photos.length }}</span>
        <span class="credit">{{ credit(photo) }}</span>
      </div>
      <div v-else class="photo empty">
        <AppIcon name="cameraOff" />
        <span>{{ p.photos == null ? 'Looking for photos…' : 'No photo' }}</span>
      </div>

      <div class="name">
        <h2 id="place-title" lang="de" :title="p.name">{{ p.name }}</h2>
        <p class="type">{{ src.subtitle ?? `${type} · ${sizeLabel(p)}` }}</p>
      </div>
    </div>

    <template v-if="thermalView">
      <div class="thermal" data-testid="thermal">
        <p v-if="!source" class="t-meta">
          This {{ feature.geometry.type === 'Polygon' ? 'place' : 'street stretch' }},
          {{ src.info?.season }}, {{ src.info?.time }}
        </p>
        <p class="temp"><strong>{{ formatDegrees(p.utci) }}</strong> feels like</p>
        <p class="verdict">
          <span class="swatch" :style="{ background: `var(--${p.thermal_state})` }" />
          <span><strong :class="['state-label', p.thermal_state]">{{ verdict.label }}:</strong> <span class="muted">{{ verdict.why }}</span></span>
        </p>
        <div class="scale" data-testid="thermal-bar">
          <div class="scale-head">
            <span>Thermal · general</span>
            <strong :class="['state-label', p.thermal_state]">{{ STATE_LABEL[p.thermal_state] }}</strong>
          </div>
          <div class="track" role="img" :aria-label="barLabel(p.utci, side)" :style="{ background: gradient }">
            <span class="diamond" :style="{ left: `${barPosition(p.utci, bar)}%` }" />
          </div>
          <div class="bar-ticks" aria-hidden="true">
            <span v-for="(t, i) in bar.ticks" :key="t.value" :class="{ first: i === 0, last: i === bar.ticks.length - 1 }"
                  :style="{ left: `${t.at}%` }">{{ deg(t.value) }}<template v-if="i === bar.ticks.length - 1"> °C</template></span>
          </div>
        </div>
        <div v-if="better" class="nearby">
          <p class="nearby-title">{{ cold ? 'Warmer' : 'Cooler' }} street nearby</p>
          <button type="button" class="nearby-link" :aria-label="betterLabel"
                  @click="area.goNearby(better.f.properties.id, better.mid, $event.detail === 0)">
            <span class="swatch" :style="{ background: `var(--${better.f.properties.thermal_state})` }" />
            <span class="nearby-text">
              <span class="nearby-name" lang="de">{{ better.f.properties.name }}</span>
              <span class="muted">{{ walkMinutes(better.d) }} min away · {{ formatDegrees(better.f.properties.utci) }}</span>
            </span>
            <AppIcon name="chevronRight" class="nearby-chevron" />
          </button>
        </div>
        <p class="foot">A simulation of sun, shade and wind, not a measurement. A prediction, not a reason.</p>
      </div>
    </template>

    <template v-else>
      <SensesPrediction v-if="sensesEntry" :entry="sensesEntry" @retry="senses.retry(sensesEntry.id)" />
      <template v-else-if="photo">
        <div class="thumbs-row">
          <div v-if="photos.length > 1" class="thumbs" role="group" aria-label="Photos of this street">
            <button v-for="(ph, i) in photos" :key="ph.pano_id + ph.heading" type="button" class="thumb"
                    :class="{ on: i === index }" :aria-label="`Photo ${i + 1}`" :aria-pressed="i === index"
                    @click="index = i">
              <img v-if="!failed.has(i)" :src="photoUrl(ph)" alt="" @error="onImgError(i)" />
            </button>
          </div>
          <div class="along">
            <p>{{ photos.length }} photo{{ photos.length > 1 ? 's' : '' }} {{ alongWord }}</p>
            <p class="muted">{{ dates }}</p>
          </div>
        </div>
        <p class="photo-line">
          Photo {{ index + 1 }} of {{ photos.length }} · {{ photoLine(photo) }}
          <span v-if="photo.contributor" class="flag">Contributor photo</span>
        </p>
        <p class="not-rated">Not rated yet. Ratings come in the next step.</p>
      </template>

      <template v-else-if="p.photos != null">
        <p class="why">No street photo here yet, so this street will have no Senses or Overall rating.</p>
        <button v-if="src.features" type="button" class="btn btn-primary" @click="goNearest">Go to the nearest street with photos</button>
        <p class="muted small">We never guess between photos: without one, a street stays unlit in Senses and Overall.</p>
      </template>
    </template>

    <slot name="foot" />
    <slot />
    <PhotoViewer v-if="viewerOpen" v-model:index="index" :feature="feature" :phone="props.phone"
                 :failed="failed" :rating="viewerRating" @close="closeViewer" @failed="onImgError" />
  </section>
</template>

<style scoped>
.t-meta { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.temp { margin: var(--space-4) 0 0; color: var(--text-2); }
.temp strong { font-size: var(--fs-xl); font-weight: var(--fw-semibold); color: var(--text); margin-right: var(--space-2); }
.verdict { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0 0; }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); flex: none; }
.state-label { font-weight: var(--fw-semibold); }
.state-label.hard { color: var(--hard-text); }
.scale {
  margin-top: var(--space-4); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.scale-head { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--fs-sm); }
.track { position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill); }
.diamond {
  position: absolute; top: 50%; width: var(--handle-size); height: var(--handle-size);
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
/* Scale ends and band borders (°C), each under its place on the bar; the ends align to the bar's ends. */
.bar-ticks { position: relative; height: calc(var(--fs-xs) * var(--lh)); margin: var(--space-2) var(--space-1) 0; font-size: var(--fs-xs); color: var(--text-muted); }
.bar-ticks span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; font-variant-numeric: tabular-nums; }
.bar-ticks .first { transform: none; }
.bar-ticks .last { transform: translateX(-100%); }
.nearby { margin-top: var(--space-4); }
.nearby-title { margin: 0; font-weight: var(--fw-semibold); }
.nearby-link {
  display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--touch-phone);
  margin-top: var(--space-2); padding: var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; color: var(--text); text-align: left;
}
.nearby-link:hover .nearby-name { text-decoration: underline; }
.nearby-text { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: var(--fs-sm); }
.nearby-name { font-size: var(--fs-md); font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.nearby-chevron { flex: none; color: var(--text-2); }
.back.from { display: flex; text-align: left; overflow-wrap: anywhere; }
.foot {
  margin: var(--space-4) 0 0; padding-top: var(--space-4); border-top: var(--hairline) solid var(--line);
  font-size: var(--fs-sm); color: var(--text-2);
}
.card { padding: var(--space-4) var(--space-5) var(--space-5); overflow-y: auto; }
.back {
  display: inline-flex; align-items: center; gap: var(--space-1);
  min-height: var(--touch); padding: 0 var(--space-2) 0 0; margin-left: calc(-1 * var(--space-1));
  border: 0; background: transparent; color: var(--text-2); font-size: var(--fs-md);
}
.top { display: flex; gap: var(--space-4); margin-top: var(--space-2); }
.photo {
  position: relative; flex: none;
  width: var(--card-photo); aspect-ratio: 1;
  border-radius: var(--radius-btn); overflow: hidden;
  background: var(--no-photo);
}
.photo-open { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-failed { display: grid; place-items: center; height: 100%; padding: var(--space-3); font-size: var(--fs-sm); color: var(--text-2); }
.photo.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2);
  border: var(--hairline) dashed var(--line); color: var(--text-2); font-size: var(--fs-sm);
}
.badge, .arrow {
  position: absolute; display: grid; place-items: center;
  width: var(--touch); height: var(--touch); border: 0; border-radius: 50%;
  background: var(--backdrop); color: var(--logo);
}
.badge.enlarge { top: var(--space-1); right: var(--space-1); border-radius: var(--radius-btn); }
.arrow { top: 50%; transform: translateY(-50%); }
.arrow.prev { left: var(--space-1); }
.arrow.next { right: var(--space-1); }
.counter, .credit {
  position: absolute; bottom: var(--space-1);
  padding: 0 var(--space-2); border-radius: var(--radius-chip);
  background: var(--backdrop); color: var(--logo); font-size: var(--fs-xs);
}
.counter { left: var(--space-1); }
.credit { right: var(--space-1); }
.name { min-width: 0; }
.name h2 {
  margin: 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold);
  /* A name is never cut: it wraps, hyphenated where the browser can, or else at any letter. */
  overflow-wrap: anywhere; hyphens: auto;
}
.type { margin: var(--space-1) 0 0; color: var(--text-2); font-size: var(--fs-sm); }
.thumbs-row { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-4); }
.thumbs { display: flex; gap: var(--space-2); flex: none; }
.thumb {
  width: var(--thumb); height: var(--thumb); padding: 0; flex: none;
  border: var(--focus-width) solid transparent; border-radius: var(--radius-chip); overflow: hidden;
  background: var(--no-photo);
}
.thumb.on { border-color: var(--accent); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.along p { margin: 0; font-size: var(--fs-sm); }
.muted { color: var(--text-2); }
.small { font-size: var(--fs-sm); }
.photo-line { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.flag {
  display: inline-block; margin-left: var(--space-2); padding: 0 var(--space-2);
  border: var(--hairline) solid var(--warning); border-radius: var(--radius-chip);
  color: var(--text); font-size: var(--fs-xs);
}
.not-rated {
  margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4);
  border: var(--hairline) dashed var(--line); border-radius: var(--radius-btn);
  color: var(--text-2); font-size: var(--fs-sm);
}
.why { margin: var(--space-4) 0 var(--space-3); }

/* Inside the phone sheet, which is the panel and does the scrolling. */
.card.sheet { padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.sheet .photo { width: var(--card-photo-phone); }
/* Phone (board P2): only the enlarge badge on the small photo; arrows and thumbnails are in the full page. */
.sheet .arrow, .sheet .counter, .sheet .thumbs { display: none; }
.sheet .btn, .sheet .back { min-height: var(--touch-phone); }
</style>
