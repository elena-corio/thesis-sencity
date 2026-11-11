<script setup>
// "Stretch ahead" (boards Routes 5, P6): the current stretch's photo (pager and enlarge), name, length and time, its
// state with the reason, what might bother, and "Rate this place". Everything comes from what is loaded: the
// photos are fetched only when shown, the ratings are the Senses ones already here, and nothing new is asked for.
// "Rate this place" and "How this works" are drawn as on the board, not built yet (Elena, 2026-11-11: Coming soon).
// A stretch without a photo shows the place card's no-photo state.
import { computed, nextTick, ref, watch } from 'vue'
import { photoUrl } from '../lib/api.js'
import { credit, photoLine } from '../lib/place.js'
import { stretchLine } from '../lib/routes.js'
import { GENERAL_LABEL, comfortLabel, elementLabel } from '../lib/senses.js'
import { comfortLine } from '../lib/walk.js'
import { useSensesStore } from '../stores/senses.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'
import PhotoViewer from './PhotoViewer.vue'
import SenseIcon from './SenseIcon.vue'

const props = defineProps({ phone: Boolean })
const walk = useWalkStore()
const senses = useSensesStore()
const enlargeBtn = ref(null)
const viewerOpen = ref(false)
const failed = ref(new Set())

const p = computed(() => walk.feature?.properties ?? {})
const photos = computed(() => walk.photos)
const photo = computed(() => walk.photo)
const place = computed(() => (photos.value.length ? senses.placeFor(photos.value) : null))
const comfort = computed(() => comfortLine(walk.layer, p.value, walk.layer === 'senses' ? place.value : null))
const bothers = computed(() => (walk.layer === 'senses' && place.value?.status === 'ok'
  ? place.value.bothers.map((e) => ({ code: e.code, icon: e.sense, ...elementLabel(e) }))
  : null))
const shownRating = computed(() => (photo.value ? senses.ratingOf(photo.value) ?? null : null))
const viewerRating = computed(() => (shownRating.value?.status === 'ok' ? `${comfortLabel(shownRating.value.result)}, this photo` : 'Not rated yet'))
const viewerNote = computed(() => (shownRating.value?.status === 'ok' ? `${GENERAL_LABEL}. A prediction, not a reason.` : ''))

watch(() => walk.current?.key, () => { failed.value = new Set() })

function stepPhoto(d) {
  const n = photos.value.length
  if (n > 1) walk.photoIndex = (walk.photoIndex + d + n) % n
}
const viewerIndex = computed({ get: () => walk.photoIndex, set: (i) => { walk.photoIndex = i } })
function openViewer() {
  if (photo.value) viewerOpen.value = true
}
function closeViewer() {
  viewerOpen.value = false
  nextTick(() => enlargeBtn.value?.focus())
}
function onImgError(i) {
  failed.value = new Set([...failed.value, i])
}
</script>

<template>
  <section v-if="walk.current" class="stretch" :class="phone ? 'phone' : ['panel', 'card']" :data-panel="phone ? undefined : 'walk-card'"
           data-scrollable aria-label="Stretch ahead">
    <!-- As on a selected stretch: back to the two routes (the same as Exit walk). -->
    <button type="button" class="back" @click="walk.exit($event.detail === 0)"><AppIcon name="chevronLeft" /> Back to comparison</button>
    <div class="top">
      <!-- The place card's photo block (boards 2f, P2): the same size, enlarge at the top, the credit on the photo. -->
      <div v-if="photo" class="photo">
        <button type="button" class="photo-open" :aria-label="`Enlarge photo ${walk.photoIndex + 1} of ${photos.length}`" @click="openViewer">
          <img v-if="!failed.has(walk.photoIndex)" :src="photoUrl(photo)" :alt="`Street photo of the stretch ahead, ${photoLine(photo)}`"
               @error="onImgError(walk.photoIndex)" />
          <span v-else class="img-failed">The photo could not be loaded.</span>
        </button>
        <button ref="enlargeBtn" type="button" class="badge enlarge" aria-label="Enlarge photo" @click="openViewer">
          <AppIcon name="expand" />
        </button>
        <template v-if="photos.length > 1">
          <button type="button" class="arrow prev" aria-label="Previous photo" @click="stepPhoto(-1)"><AppIcon name="chevronLeft" /></button>
          <button type="button" class="arrow next" aria-label="Next photo" @click="stepPhoto(1)"><AppIcon name="chevronRight" /></button>
        </template>
        <span class="counter">{{ walk.photoIndex + 1 }} / {{ photos.length }}</span>
        <span class="credit">{{ credit(photo) }}</span>
      </div>
      <div v-else class="photo empty">
        <AppIcon name="cameraOff" />
        <span>{{ p.photos == null ? 'Looking for photos…' : 'No photo' }}</span>
      </div>
      <div class="name">
        <p v-if="phone" class="eyebrow">Stretch ahead</p>
        <h2 lang="de" :title="p.name">{{ p.name }}</h2>
        <p class="meta">{{ stretchLine(walk.current) }}</p>
      </div>
    </div>

    <p class="state" data-testid="walk-state">
      <span class="swatch" :style="{ background: `var(--${comfort.state === 'none' ? 'no-photo' : comfort.state})` }" />
      <strong :class="['label', comfort.state]">{{ comfort.label }}</strong>
      <span class="muted">{{ comfort.reason }}</span>
    </p>
    <p v-if="!photo && p.photos != null && walk.layer === 'senses'" class="why">
      No street photo here yet, so this street will have no Senses or Overall rating.
    </p>
    <p class="note muted">A prediction, not a reason.</p>

    <template v-if="bothers">
      <div class="rule" />
      <section class="bothers">
        <h3>Might bother you</h3>
        <ul v-if="bothers.length">
          <li v-for="e in bothers" :key="e.code"><SenseIcon :sense="e.icon" :label="e.sense" /><span>{{ e.text }}</span></li>
        </ul>
        <p v-else class="muted">Nothing named in enough of the photos.</p>
      </section>
    </template>

    <div class="rule" />
    <div class="rate">
      <div class="rate-row">
        <span id="rate-title" class="rate-title">Rate this place</span>
        <div role="group" aria-labelledby="rate-title" aria-describedby="rate-soon" class="rate-buttons">
          <button v-for="n in 5" :key="n" type="button" class="rate-btn" :aria-label="`Rate ${n} of 5`" aria-disabled="true"
                  title="Coming soon">{{ n }}</button>
        </div>
      </div>
      <div class="rate-foot">
        <span>From the photo. It tunes your profile.</span>
        <button type="button" class="link" aria-disabled="true" title="Coming soon" aria-describedby="rate-soon">How this works</button>
      </div>
      <span id="rate-soon" class="visually-hidden">Coming soon</span>
    </div>

    <PhotoViewer v-if="viewerOpen" v-model:index="viewerIndex" :feature="walk.feature" :phone="props.phone" :failed="failed"
                 :rating="viewerRating" :rating-note="viewerNote" @close="closeViewer" @failed="onImgError" />
  </section>
</template>

<style scoped>
.card { padding: var(--space-4) var(--space-4) var(--space-5); overflow-y: auto; }
.stretch { display: flex; flex-direction: column; gap: var(--space-3); }
p { margin: 0; }
.muted { color: var(--text-2); }

.back {
  display: inline-flex; align-self: flex-start; align-items: center; gap: var(--space-1);
  min-height: var(--touch); padding: 0 var(--space-2) 0 0; margin: 0 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-1));
  border: 0; background: transparent; color: var(--text-2); font-size: var(--fs-md);
}
.phone .back { min-height: var(--touch-phone); }
/* The photo block of the place card (PlaceCard.vue): the same sizes and places. */
.top { display: flex; gap: var(--space-4); align-items: flex-start; }
.photo {
  position: relative; flex: none; width: var(--card-photo); aspect-ratio: 1;
  border-radius: var(--radius-btn); overflow: hidden; background: var(--no-photo);
}
.phone .photo { width: var(--card-photo-phone); }
.photo-open { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-failed { display: grid; place-items: center; height: 100%; padding: var(--space-3); font-size: var(--fs-sm); color: var(--text-2); }
.badge, .arrow {
  position: absolute; display: grid; place-items: center;
  width: var(--touch); height: var(--touch); border: 0; border-radius: 50%;
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow);
}
.badge.enlarge { top: var(--space-1); right: var(--space-1); border-radius: var(--radius-btn); }
.arrow { top: 50%; transform: translateY(-50%); }
.arrow.prev { left: var(--space-1); }
.arrow.next { right: var(--space-1); }
.counter, .credit {
  position: absolute; bottom: var(--space-1);
  padding: 0 var(--space-2); border-radius: var(--radius-chip);
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow); font-size: var(--fs-xs);
}
.counter { left: var(--space-1); }
.credit { right: var(--space-1); }
/* Phone (board P2): only the enlarge badge on the small photo; the arrows are in the enlarged photo. */
.phone .arrow, .phone .counter { display: none; }
.photo.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2);
  border: var(--hairline) dashed var(--line); color: var(--text-2); font-size: var(--fs-xs);
}

.name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding-top: 2px; }
/* Small text uses --text-2, not the board's muted grey, which is under 4.5:1 on white. */
.eyebrow { font-size: var(--fs-2xs); font-weight: var(--fw-semibold); letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-2); }
.name h2 { margin: 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold); line-height: 1.25; overflow-wrap: anywhere; hyphens: auto; }
.meta { font-size: var(--fs-xs); color: var(--text-2); }

.state { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) calc(var(--space-2) + 2px); }
.swatch { flex: none; width: calc(var(--space-5) - 2px); height: calc(var(--swatch-h) + 1px); border-radius: var(--radius-pill); }
.label { font-weight: var(--fw-semibold); }
.label.hard { color: var(--hard-text); }
.note, .why { font-size: var(--fs-xs); }
.rule { height: var(--hairline); background: var(--line); }

.bothers h3, .rate-title { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.bothers ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.bothers li { display: flex; align-items: center; gap: calc(var(--space-2) + 2px); font-size: var(--fs-sm); }
.bothers li :deep(svg) { color: var(--hard); }
.bothers .muted { margin-top: var(--space-2); font-size: var(--fs-sm); }
/* Phone (board P6): the same as chips. */
.phone .bothers ul { flex-direction: row; flex-wrap: wrap; gap: var(--space-2); }
.phone .bothers li {
  gap: var(--space-2); padding: var(--space-2) calc(var(--space-2) + 2px);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill); font-size: var(--fs-xs);
}

.rate { display: flex; flex-direction: column; gap: var(--space-2); }
.rate-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.rate-buttons { display: flex; gap: var(--space-1); }
.rate-btn {
  width: var(--rate-w); height: var(--rate-h); padding: 0;
  border: var(--hairline) solid var(--line); border-radius: var(--radius-chip); background: transparent;
  color: var(--text); font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
}
.phone .rate-btn { width: var(--rate-w-phone); height: var(--rate-h-phone); }
.rate-foot { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--fs-2xs); line-height: 1.45; color: var(--text-2); }
.link { flex: none; padding: 0; border: 0; background: transparent; color: var(--text-2); font-size: inherit; text-decoration: underline; }
</style>
