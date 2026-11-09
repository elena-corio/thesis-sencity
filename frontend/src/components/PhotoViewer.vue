<script setup>
// Enlarged photo (board 2f+; phone P2+). Over the dimmed app (90%) on desktop, a full page on a
// phone. Arrow keys switch photos, Esc goes back, focus stays inside while it is open.
// Images come from the API on demand and are never stored (Google terms).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { photoUrl } from '../lib/api.js'
import { credit, distanceLine, photoLine } from '../lib/place.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  feature: { type: Object, required: true },
  index: { type: Number, required: true },
  phone: Boolean,
  failed: { type: Set, default: () => new Set() },
  /** This photo's rating, in words. */
  rating: { type: String, default: 'Not rated yet' },
})
const emit = defineEmits(['update:index', 'close', 'failed'])

const dialog = ref(null)
const backBtn = ref(null)
const photos = computed(() => props.feature.properties.photos ?? [])
const photo = computed(() => photos.value[props.index])
const name = computed(() => props.feature.properties.name)
const n = computed(() => photos.value.length)

function go(d) {
  if (n.value > 1) emit('update:index', (props.index + d + n.value) % n.value)
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    go(1)
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    go(-1)
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
})
onBeforeUnmount(() => { document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <div ref="dialog" class="viewer" :class="{ phone }" role="dialog" aria-modal="true" data-viewer
         :aria-label="`Photo ${index + 1} of ${n}, ${name}`" @keydown="onKey">
      <div class="inner">
        <header class="bar">
          <button ref="backBtn" type="button" class="back" @click="emit('close')">
            <AppIcon name="chevronLeft" /> Back to place
          </button>
          <span class="count" aria-live="polite">Photo {{ index + 1 }} of {{ n }}</span>
        </header>

        <div class="stage" @pointerdown="onPointerDown" @pointerup="onPointerUp">
          <button v-if="n > 1" type="button" class="arrow prev" aria-label="Previous photo" @click="go(-1)">
            <AppIcon name="chevronLeft" />
          </button>
          <div class="photo">
            <img v-if="!failed.has(index)" :src="photoUrl(photo)" :alt="`Street photo of ${name}, ${photoLine(photo)}`"
                 draggable="false" @error="emit('failed', index)" />
            <span v-else class="img-failed">The photo could not be loaded.</span>
            <span class="credit">{{ credit(photo) }}</span>
          </div>
          <button v-if="n > 1" type="button" class="arrow next" aria-label="Next photo" @click="go(1)">
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
          <p class="not-rated">{{ rating }}</p>
        </div>

        <div v-if="n > 1" class="thumbs" role="group" aria-label="All photos of this street">
          <button v-for="(ph, i) in photos" :key="ph.pano_id + ph.heading" type="button" class="thumb"
                  :class="{ on: i === index }" :aria-label="`Photo ${i + 1}`" :aria-pressed="i === index"
                  @click="emit('update:index', i)">
            <img v-if="!failed.has(i)" :src="photoUrl(ph)" alt="" draggable="false" />
          </button>
        </div>

        <p class="hint">
          <template v-if="phone">Swipe or tap the arrows for the next photo.</template>
          <template v-else>Arrow keys for the next photo, Esc to go back.</template>
          Ratings come in the next step.
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
  background: var(--backdrop); color: var(--logo); font-size: var(--fs-sm);
}
.arrow {
  width: var(--viewer-arrow); height: var(--viewer-arrow); flex: none;
  display: grid; place-items: center;
  border: var(--hairline) solid var(--line); border-radius: 50%;
  background: var(--panel); color: var(--text);
}
.info { width: var(--viewer-photo); display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
.info h2 { margin: 0; font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.muted { margin: var(--space-1) 0 0; color: var(--text-2); }
.not-rated { margin: 0; color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; }
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
  background: var(--backdrop); color: var(--logo); border: 0;
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
