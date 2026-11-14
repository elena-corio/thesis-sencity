<script setup>
// Enlarged photo (board 2f+; phone P2+). Over the dimmed app (90%) on desktop, a full page on a
// phone. Esc goes back, focus stays inside while it is open. What the arrows step through is named on them, in the
// counter and in the hint, and the keys, the arrow buttons and a swipe do the same (Elena, 2026-11-14): the stretches of
// a route when opened from a stretch (one photo each), the photos when a place has more than one; nothing otherwise.
// Images are Mapillary's thumbnails, loaded on demand and never stored.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { photoCredit, photoLink, shownPhotoUrl } from '../lib/photos.js'
import { distanceLine, photoLine } from '../lib/place.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  /** The photos shown, when not the street's own (Mapillary on the cards). */
  photos: { type: Array, default: null },
  feature: { type: Object, required: true },
  index: { type: Number, required: true },
  phone: Boolean,
  failed: { type: Set, default: () => new Set() },
  /** This photo's rating, in words. */
  rating: { type: String, default: 'Not rated yet' },
  /** What kind of rating it is, shown under it. */
  ratingNote: { type: String, default: '' },
  /** Opened from a stretch of a route: { noun: 'stretch', index, count }; the arrows step through them ("step"). */
  steps: { type: Object, default: null },
})
const emit = defineEmits(['update:index', 'close', 'failed', 'step'])

const dialog = ref(null)
const backBtn = ref(null)
const photos = computed(() => props.photos ?? props.feature.properties.photos ?? [])
const photo = computed(() => photos.value[props.index])
const name = computed(() => props.feature.properties.name)
const n = computed(() => photos.value.length)
/** What the arrows step through: the route's stretches, the place's photos, or nothing (null). */
const nav = computed(() => {
  if (props.steps?.count > 1) return { noun: props.steps.noun, i: props.steps.index, n: props.steps.count, ends: true }
  return n.value > 1 ? { noun: 'photo', i: props.index, n: n.value, ends: false } : null
})
const Noun = computed(() => (nav.value ? nav.value.noun[0].toUpperCase() + nav.value.noun.slice(1) : ''))
/** Stretches stop at the first and the last; photos go round. */
const canGo = (d) => !!nav.value && (!nav.value.ends || (nav.value.i + d >= 0 && nav.value.i + d < nav.value.n))

function go(d, keyboard = false) {
  if (!canGo(d)) return
  if (nav.value.ends) emit('step', d, keyboard)
  else emit('update:index', (props.index + d + n.value) % n.value)
}

// The keys are the viewer's while it is open, wherever the focus is (a click on the photo must not hand them to the card
// behind it).
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    e.stopPropagation()
    go(e.key === 'ArrowRight' ? 1 : -1, true)
  } else if (e.key === 'Tab') {
    // Keep focus inside the dialog.
    const items = [...dialog.value.querySelectorAll('button:not([disabled])')]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
}

// Phone: swipe left or right to change photo.
let swipeX = null
function onPointerDown(e) { swipeX = e.clientX }
function onPointerUp(e) {
  if (swipeX == null) return
  const dx = e.clientX - swipeX
  swipeX = null
  if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
}

onMounted(() => {
  nextTick(() => backBtn.value?.focus())
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <div ref="dialog" class="viewer" :class="{ phone }" role="dialog" aria-modal="true" data-viewer tabindex="-1"
         :aria-label="nav ? `Photo, ${nav.noun} ${nav.i + 1} of ${nav.n}, ${name}` : `Photo, ${name}`">
      <div class="inner">
        <header class="bar">
          <button ref="backBtn" type="button" class="back" @click="emit('close')">
            <AppIcon name="chevronLeft" /> Back to place
          </button>
          <span v-if="nav" class="count" aria-live="polite" data-testid="viewer-count">{{ Noun }} {{ nav.i + 1 }} of {{ nav.n }}</span>
        </header>

        <div class="stage" @pointerdown="onPointerDown" @pointerup="onPointerUp">
          <button v-if="nav" type="button" class="arrow prev" :aria-label="`Previous ${nav.noun}`" :title="`Previous ${nav.noun}`"
                  :aria-disabled="!canGo(-1)" @click="go(-1)">
            <AppIcon name="chevronLeft" />
          </button>
          <div class="photo">
            <img v-if="!failed.has(index)" :src="shownPhotoUrl(photo)" :alt="`Street photo of ${name}, ${photoLine(photo)}`"
                 draggable="false" @error="emit('failed', index)" />
            <span v-else class="img-failed">The photo could not be loaded.</span>
            <a v-if="photoLink(photo)" class="credit" :href="photoLink(photo)" target="_blank" rel="noopener">{{ photoCredit(photo) }}</a>
            <span v-else class="credit">{{ photoCredit(photo) }}</span>
          </div>
          <button v-if="nav" type="button" class="arrow next" :aria-label="`Next ${nav.noun}`" :title="`Next ${nav.noun}`"
                  :aria-disabled="!canGo(1)" @click="go(1)">
            <AppIcon name="chevronRight" />
          </button>
        </div>

        <div v-if="phone && n > 1" class="dots" aria-hidden="true">
          <span v-for="i in n" :key="i" :class="{ on: i - 1 === index }" />
        </div>

        <div class="info">
          <div>
            <h2>{{ name }}</h2>
            <p class="muted">{{ photoLine(photo) }}, {{ distanceLine(photo, feature) }}</p>
          </div>
          <div class="rating">
            <p class="not-rated" :class="{ wrap: ratingNote }">{{ rating }}</p>
            <p v-if="ratingNote" class="rating-note">{{ ratingNote }}</p>
          </div>
        </div>

        <div v-if="n > 1" class="thumbs" role="group" aria-label="All photos of this street">
          <button v-for="(ph, i) in photos" :key="ph.id + ph.heading" type="button" class="thumb"
                  :class="{ on: i === index }" :aria-label="`Photo ${i + 1}`" :aria-pressed="i === index"
                  @click="emit('update:index', i)">
            <img v-if="!failed.has(i)" :src="shownPhotoUrl(ph)" alt="" draggable="false" />
          </button>
        </div>

        <p class="hint">
          <template v-if="nav && phone">Swipe or tap the arrows for the previous or next {{ nav.noun }}.</template>
          <template v-else-if="nav">The arrows, or the ← → keys: previous or next {{ nav.noun }}. Esc to go back.</template>
          <template v-else-if="!phone">Esc to go back.</template>
          <template v-if="!ratingNote">Ratings come in the next step.</template>
          <template v-else-if="n > 1">The street rating combines all {{ n }} photos.</template>
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed; inset: 0; z-index: 50;
  background: var(--overlay-photo);
  color: var(--text);
  display: flex; justify-content: center;
  overflow-y: auto;
}
.inner {
  width: min(100%, calc(var(--viewer-photo) + 2 * (var(--viewer-arrow) + var(--space-5))));
  padding: var(--space-4) var(--space-4) var(--space-5);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
}
.bar { width: var(--viewer-photo); display: flex; justify-content: space-between; align-items: center; }
.back {
  display: inline-flex; align-items: center; gap: var(--space-1);
  min-height: var(--touch); border: 0; background: transparent; color: var(--text); font-size: var(--fs-md);
}
.count { font-size: var(--fs-md); }
.stage { display: flex; align-items: center; gap: var(--space-5); touch-action: pan-y; }
.photo {
  position: relative; width: var(--viewer-photo); aspect-ratio: 1;
  border-radius: var(--radius-btn); overflow: hidden; background: var(--no-photo);
}
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; }
.img-failed { display: grid; place-items: center; height: 100%; color: var(--text-2); }
.credit {
  position: absolute; left: var(--space-3); bottom: var(--space-3);
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-chip);
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow); font-size: var(--fs-sm);
}
a.credit { text-decoration: none; }
a.credit:hover { text-decoration: underline; }
.arrow {
  width: var(--viewer-arrow); height: var(--viewer-arrow); flex: none;
  display: grid; place-items: center;
  border: var(--hairline) solid var(--line); border-radius: 50%;
  background: var(--panel); color: var(--text);
}
.arrow[aria-disabled="true"] { opacity: var(--inactive-opacity); cursor: default; }
.info { width: var(--viewer-photo); display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
.info h2 { margin: 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.muted { margin: var(--space-1) 0 0; color: var(--text-2); }
.not-rated { margin: 0; color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; }
.not-rated.wrap { white-space: normal; color: var(--text); font-weight: var(--fw-semibold); }
.rating { min-width: 0; flex: 0 1 50%; }
.rating-note { margin: var(--space-1) 0 0; color: var(--text-2); font-size: var(--fs-xs); }
.thumbs { display: flex; gap: var(--space-3); }
.thumb {
  width: calc(var(--thumb) * 1.6); height: calc(var(--thumb) * 1.6); padding: 0;
  border: var(--focus-width) solid transparent; border-radius: var(--radius-btn); overflow: hidden;
  background: var(--no-photo);
}
.thumb.on { border-color: var(--accent); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hint { margin: 0; color: var(--text-2); font-size: var(--fs-sm); text-align: center; }

/* Phone (board P2+): a full page; the photo spans the width, arrows sit on it. */
.viewer.phone { background: var(--ground); }
.phone .inner { width: 100%; padding: 0 0 var(--space-5); align-items: stretch; gap: var(--space-3); }
.phone .bar { width: auto; padding: var(--space-2) var(--space-4) 0; }
.phone .back, .phone .arrow { min-height: var(--touch-phone); }
.phone .stage { position: relative; display: block; }
.phone .photo { width: 100%; border-radius: 0; }
.phone .arrow {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 1;
  width: var(--touch-phone); height: var(--touch-phone);
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow); border: 0;
}
.phone .arrow.prev { left: var(--space-3); }
.phone .arrow.next { right: var(--space-3); }
.dots { display: flex; justify-content: center; gap: var(--space-2); }
.dots span { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-pill); background: var(--line); }
.dots span.on { width: var(--space-5); background: var(--text); }
.phone .info { width: auto; padding: 0 var(--space-4); flex-direction: column; gap: var(--space-2); }
.phone .thumbs { padding: 0 var(--space-4); }
.phone .thumb { width: calc(var(--thumb) * 1.4); height: calc(var(--thumb) * 1.4); }
.phone .hint { padding: 0 var(--space-4); text-align: left; }
</style>
