<script setup>
// The walk (Elena, 2026-11-14): a slideshow of the route's photos, with no 3D street and no turning camera. Left: which
// way is walked, Exit, "Stretch n of N", the photo the stretch is rated from with previous / next stretch beside it, then,
// as wide as the photo, the route bar (a click on a section jumps there), Play, the progress and the key (board Routes 5,
// photos and play). Right: "Where you are" (a flat mini map, north up, with your spot and the photo's direction) and the
// stretch's card. On a phone, one
// column that scrolls, above the tab bar. The keys: ← → the previous or next stretch, space plays or pauses
// (WalkControls), Esc exits.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'
import MapAttribution from './MapAttribution.vue'
import WalkChip from './WalkChip.vue'
import WalkControls from './WalkControls.vue'
import WalkDetails from './WalkDetails.vue'
import WalkMiniMap from './WalkMiniMap.vue'
import WalkPhoto from './WalkPhoto.vue'

const props = defineProps({ phone: Boolean })
const walk = useWalkStore()
const backBtn = ref(null)
const count = computed(() => `Stretch ${walk.index + 1} of ${walk.stretches.length}`)

function onKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[data-viewer]')) return
  e.preventDefault()
  walk.exit(true)
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (walk.byKeyboard) nextTick(() => backBtn.value?.focus())
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="walk-view panel" :class="{ phone: props.phone }" data-panel="walk-view" aria-label="Walk"
           :data-scrollable="props.phone ? '' : undefined">
    <div class="main">
      <div class="head">
        <button ref="backBtn" type="button" class="back" @click="walk.exit($event.detail === 0)">
          <AppIcon name="chevronLeft" /> Exit walk, back to comparison
        </button>
        <WalkChip :phone="props.phone" />
        <span class="count" data-testid="walk-count">{{ count }}</span>
      </div>

      <!-- The photo, and under it Play and the bar, as wide as the photo; the arrows beside the photo, at its middle. -->
      <div class="stage">
        <button type="button" class="arrow prev" aria-label="Previous stretch" title="Previous stretch"
                :aria-disabled="walk.index === 0" @click="walk.step(-1, $event.detail === 0)">
          <AppIcon name="chevronLeft" />
        </button>
        <div class="column">
          <div class="window"><WalkPhoto :phone="props.phone" /></div>
          <WalkControls :phone="props.phone" />
        </div>
        <button type="button" class="arrow next" aria-label="Next stretch" title="Next stretch"
                :aria-disabled="walk.atEnd" @click="walk.step(1, $event.detail === 0)">
          <AppIcon name="chevronRight" />
        </button>
      </div>
    </div>

    <div class="side">
      <p class="where"><span class="title">Where you are</span></p>
      <WalkMiniMap />
      <div class="rule" />
      <WalkDetails :phone="props.phone" />
      <MapAttribution v-if="props.phone" in-sheet />
    </div>
  </section>
</template>

<style scoped>
p { margin: 0; }
.walk-view {
  display: grid; grid-template-columns: minmax(0, 1fr) var(--walk-view-side-w); gap: var(--space-5);
  height: 100%; padding: var(--space-4) var(--space-5); border-radius: var(--radius-panel);
}
.main { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; min-height: 0; }
/* Exit on the left, the chip in the middle (over the photo, which is centred too), the count on the right. */
.head {
  display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--space-4);
}
.head :deep(.chip) { justify-self: center; max-width: 100%; }
.back {
  display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--touch);
  padding: 0; border: 0; background: transparent; color: var(--text-2); font-size: var(--fs-sm);
}
.back :deep(.icon) { width: var(--icon-sm); height: var(--icon-sm); }
.back { justify-self: start; }
.count { justify-self: end; font-size: var(--fs-sm); color: var(--text-2); font-variant-numeric: tabular-nums; }
/* The photo as large as the space allows (square), with room under it for Play and the bar. */
.stage {
  flex: 1; min-height: 0; container-type: size;
  display: flex; align-items: flex-start; justify-content: center; gap: var(--space-4);
}
.stage > * {
  --photo: min(calc(100cqw - 2 * var(--walk-arrow) - 2 * var(--space-4)),
    calc(100cqh - var(--walk-controls-h) - var(--space-3)), var(--walk-view-photo-max));
}
.column { display: flex; flex-direction: column; gap: var(--space-3); width: var(--photo); }
.arrow { margin-top: calc(var(--photo) / 2 - var(--walk-arrow) / 2); }
.arrow {
  flex: none; display: grid; place-items: center; width: var(--walk-arrow); height: var(--walk-arrow); padding: 0;
  border: var(--hairline) solid var(--line); border-radius: 50%; background: var(--panel); color: var(--text);
}
.arrow[aria-disabled="true"] { opacity: var(--inactive-opacity); cursor: default; }
.side { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; overflow-y: auto; }
.where .title { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.rule { height: var(--hairline); background: var(--line); }

/* Phone: one column that scrolls; the arrows sit on the photo. */
.walk-view.phone {
  display: flex; flex-direction: column; gap: var(--space-3); overflow-y: auto;
  padding: var(--space-3); border-radius: var(--radius-panel) var(--radius-panel) 0 0;
}
.phone .main, .phone .side { flex: none; overflow: visible; }
.phone .head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1) var(--space-3); }
.phone .head :deep(.chip) { order: 3; width: 100%; }
.phone .back { min-height: var(--touch-phone); }
.phone .stage { position: relative; display: block; flex: none; container-type: normal; }
.phone .column { width: 100%; }
.phone .arrow {
  position: absolute; top: 0; margin-top: calc(50vw - var(--space-3) - var(--touch-phone) / 2); z-index: 1;
  width: var(--touch-phone); height: var(--touch-phone); border: 0;
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow);
}
.phone .arrow.prev { left: var(--space-2); }
.phone .arrow.next { right: var(--space-2); }
</style>
