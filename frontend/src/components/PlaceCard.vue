<script setup>
// Place card (boards 2f, 2g; phone P2): the selected segment's photos. No ratings yet.
// Images load only now, on click: the current photo, and the others of this street (at most 3,
// so the previous and next ones) for the thumbnails. The same URL is reused, so each loads once.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { photoUrl } from '../lib/api.js'
import { formatMonth } from '../lib/geo.js'
import { credit, nearestWithPhotos, photoLine, sizeLabel, typeLabel } from '../lib/place.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'
import PhotoViewer from './PhotoViewer.vue'

const props = defineProps({ phone: Boolean })
const area = useAreaStore()
const backBtn = ref(null)
const enlargeBtn = ref(null)
const index = ref(0)
const viewerOpen = ref(false)
const failed = ref(new Set())

const feature = computed(() => area.selected)
const p = computed(() => feature.value?.properties)
const photos = computed(() => p.value?.photos ?? [])
const photo = computed(() => photos.value[index.value])
const type = computed(() => (feature.value ? typeLabel(p.value, feature.value.geometry.type) : ''))
const dates = computed(() => [...new Set(photos.value.map((ph) => formatMonth(ph.date)))].join(', '))
const alongWord = computed(() => (feature.value?.geometry.type === 'Polygon' ? 'in this place' : 'along this street'))

watch(() => area.selectedId, () => {
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
  const near = nearestWithPhotos(feature.value, area.segments.features)
  if (near) area.select(near.f.properties.id, near.mid)
}

function onImgError(i) {
  failed.value = new Set([...failed.value, i])
}

// Opened with the keyboard: focus starts on "Back to area".
onMounted(() => { if (area.byKeyboard) backBtn.value?.focus() })
watch(() => area.selectedId, () => { if (area.byKeyboard) nextTick(() => backBtn.value?.focus()) })
</script>

<template>
  <section v-if="feature" class="card panel" :class="{ sheet: props.phone }" data-panel="place-card" data-scrollable
           aria-labelledby="place-title">
    <div v-if="props.phone" class="grip" aria-hidden="true" />
    <button ref="backBtn" type="button" class="back" @click="area.clearSelection()">
      <AppIcon name="chevronLeft" /> Back to area
    </button>

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
        <h2 id="place-title" :title="p.name">{{ p.name }}</h2>
        <p class="type">{{ type }} · {{ sizeLabel(p) }}</p>
      </div>
    </div>

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
      <button type="button" class="btn btn-primary" @click="goNearest">Go to the nearest street with photos</button>
      <p class="muted small">We never guess between photos: streets without one stay unlit.</p>
    </template>

    <slot />
    <PhotoViewer v-if="viewerOpen" v-model:index="index" :feature="feature" :phone="props.phone"
                 :failed="failed" @close="closeViewer" @failed="onImgError" />
  </section>
</template>

<style scoped>
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
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
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
