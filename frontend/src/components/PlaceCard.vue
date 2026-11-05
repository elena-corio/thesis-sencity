<script setup>
// Place card (boards 2f, 2g; phone P2): the selected segment's photo and name. On the Thermal layer
// (board 2e) the photo stays (Elena's choice) and the rest is thermal comfort only: how warm or cold it
// feels, the state and why, the 1–5 bar and a cooler (or warmer) street nearby. No photo ratings yet.
// Images load only now, on click: the current photo, and the others of this street (at most 3,
// so the previous and next ones) for the thumbnails. The same URL is reused, so each loads once.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { photoUrl } from '../lib/api.js'
import { formatMonth } from '../lib/geo.js'
import { credit, nearest, nearestWithPhotos, photoLine, sizeLabel, typeLabel } from '../lib/place.js'
import { formatDegrees, isCold, thermalReason, walkMinutes } from '../lib/thermal.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'
import PhotoViewer from './PhotoViewer.vue'

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
const enlargeBtn = ref(null)
const index = ref(0)
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
const cold = computed(() => thermalView.value && isCold(p.value.utci))
/** The nearest street that feels better (a higher score), for "Cooler street nearby"; none if already easy. */
const better = computed(() => {
  if (!thermalView.value || !src.value.features || p.value.thermal_state === 'easy') return null
  const score = p.value.thermal_score
  return nearest(feature.value, src.value.features, (f) => f.properties.thermal_score > score)
})
const alongWord = computed(() => (feature.value?.geometry.type === 'Polygon' ? 'in this place' : 'along this street'))

watch(() => src.value.key, () => {
  index.value = 0
  failed.value = new Set()
})

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

// Opened with the keyboard: focus starts on "Back to area".
onMounted(() => { if (src.value.byKeyboard) backBtn.value?.focus() })
watch(() => src.value.key, () => { if (src.value.byKeyboard && !props.source) nextTick(() => backBtn.value?.focus()) })
</script>

<template>
  <section v-if="feature" class="card panel" :class="{ sheet: props.phone }" data-panel="place-card" data-scrollable
           aria-labelledby="place-title">
    <div v-if="props.phone" class="grip" aria-hidden="true" />
    <button ref="backBtn" type="button" class="back" @click="src.back($event.detail === 0)">
      <AppIcon name="chevronLeft" /> {{ src.backLabel }}
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
          <strong :class="['state-label', p.thermal_state]">{{ STATE_LABEL[p.thermal_state] }}</strong>
          <span class="muted">{{ thermalReason(p.utci) }}</span>
        </p>
        <div class="scale" role="img" :aria-label="`Thermal: ${STATE_LABEL[p.thermal_state]}, ${p.thermal_score} of 5`">
          <div class="scale-head">
            <span>Thermal · general</span>
            <span><strong :class="['state-label', p.thermal_state]">{{ STATE_LABEL[p.thermal_state] }}</strong> · {{ p.thermal_score }} of 5</span>
          </div>
          <div class="track"><span class="diamond" :style="{ left: `${(p.thermal_score - 1) * 25}%` }" /></div>
          <div class="ticks" aria-hidden="true"><span v-for="n in 5" :key="n">{{ n }}</span></div>
        </div>
        <div v-if="better" class="nearby">
          <p class="nearby-title">{{ cold ? 'Warmer' : 'Cooler' }} street nearby</p>
          <button type="button" class="nearby-link" @click="area.select(better.f.properties.id, better.mid)">
            <span class="swatch" :style="{ background: `var(--${better.f.properties.thermal_state})` }" />
            {{ better.f.properties.name }}, {{ walkMinutes(better.d) }} min away, {{ formatDegrees(better.f.properties.utci) }}
          </button>
        </div>
        <p class="foot">A simulation of sun, shade and wind, not a measurement. A prediction, not a reason.</p>
      </div>
    </template>

    <template v-else>
      <template v-if="photo">
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
                 :failed="failed" @close="closeViewer" @failed="onImgError" />
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
.track {
  position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill);
  background: linear-gradient(to right, var(--hard), var(--mixed), var(--easy));
}
.diamond {
  position: absolute; top: 50%; width: var(--handle-size); height: var(--handle-size);
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
.ticks { display: flex; justify-content: space-between; margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-muted); }
.nearby { margin-top: var(--space-4); }
.nearby-title { margin: 0; font-weight: var(--fw-semibold); }
.nearby-link {
  display: flex; align-items: center; gap: var(--space-2); min-height: var(--touch); padding: 0;
  border: 0; background: transparent; color: var(--text); text-align: left;
}
.nearby-link:hover { text-decoration: underline; }
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

.sheet {
  border-radius: var(--radius-panel) var(--radius-panel) 0 0; border-bottom: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet .photo { width: var(--card-photo-phone); }
/* Phone (board P2): only the enlarge badge on the small photo; arrows and thumbnails are in the full page. */
.sheet .arrow, .sheet .counter, .sheet .thumbs { display: none; }
.sheet .btn, .sheet .back { min-height: var(--touch-phone); }
.grip {
  width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-2);
  border-radius: var(--radius-pill); background: var(--line);
}
</style>
