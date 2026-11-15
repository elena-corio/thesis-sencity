<script setup>
// The photo of the stretch ahead (WalkView): one square photo, facing along the walk. No enlarge and no labels: only the
// credit, inside the frame (Mapillary: "{username} · {year} · CC BY-SA 4.0", linked to the image page). The photo is the
// one the stretch is rated from, its street's, as on the stretch card (stores/walk.js). With no photo, or one that does not load,
// the square says so, and there is no rating either (Elena, 2026-11-14). Images are loaded when shown, never stored.
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { panoShift, photoCredit, photoLink, shownPhotoUrl } from '../lib/photos.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const name = computed(() => walk.feature?.properties.name ?? 'the street')
const source = 'Mapillary'
const message = computed(() => {
  if (walk.photoState === 'none-here') return 'No photo for this stretch, so no rating.'
  if (walk.photoState === 'unloaded') return 'The photo could not be loaded, so no rating.'
  return 'Photos are not shown.'
})
/** A panorama: the 90 degree view at the walk's bearing, cut from the equirectangular thumbnail (lib/photos.js). */
const panoStyle = computed(() => (walk.photo?.pano ? {
  backgroundImage: `url("${shownPhotoUrl(walk.photo)}")`,
  backgroundPositionX: `calc(${panoShift(walk.photo)} * 100cqw)`,
} : null))
const failed = () => walk.photoFailed(walk.photo)
</script>

<template>
  <div class="walk-photo" :class="{ phone }">
    <figure v-if="walk.photoState === 'shown'" class="frame" :aria-label="`${source} photo of the stretch ahead`" data-testid="walk-photo">
      <template v-if="panoStyle">
        <div class="pano" role="img" :aria-label="`${source} panorama at eye level, looking along ${name}`" :style="panoStyle" data-testid="walk-pano" />
        <img class="probe" :src="shownPhotoUrl(walk.photo)" alt="" @error="failed" />
      </template>
      <img v-else :src="shownPhotoUrl(walk.photo)" :alt="`${source} photo at eye level, looking along ${name}`" @error="failed" />
      <a v-if="photoLink(walk.photo)" class="credit" :href="photoLink(walk.photo)" target="_blank" rel="noopener">{{ photoCredit(walk.photo) }}</a>
      <span v-else class="credit">{{ photoCredit(walk.photo) }}</span>
    </figure>
    <div v-else class="empty">
      <AppIcon name="cameraOff" />
      <p role="status" data-testid="walk-no-photo">{{ message }}</p>
    </div>
  </div>
</template>

<style scoped>
.walk-photo { width: 100%; aspect-ratio: 1; }
.frame {
  position: relative; width: 100%; height: 100%; margin: 0; overflow: hidden;
  border: var(--hairline) solid var(--line); border-radius: var(--radius-panel); background: var(--ground); box-shadow: var(--shadow);
}
.phone .frame { border-radius: var(--radius-bar); }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* A panorama: four frame widths of the 360 degree image, around the horizon, repeated across north. */
.frame { container-type: inline-size; }
.pano { width: 100%; height: 100%; background-size: 400% auto; background-repeat: repeat-x; background-position-y: 50%; }
.frame img.probe { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.credit {
  position: absolute; right: var(--space-2); bottom: var(--space-2); max-width: calc(100% - 2 * var(--space-2));
  padding: 0 var(--space-2); border-radius: var(--radius-chip); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow); font-size: var(--fs-xs);
}
/* Phone: the licence must stay readable, so the credit wraps rather than being cut. */
.phone .credit { white-space: normal; text-align: right; line-height: 1.3; font-size: var(--fs-2xs); }
a.credit { text-decoration: none; }
a.credit:hover { text-decoration: underline; }
.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2);
  width: 100%; height: 100%; padding: var(--space-4);
  border: var(--hairline) dashed var(--line); border-radius: var(--radius-panel); color: var(--text-2); text-align: center;
}
.empty p { margin: 0; font-size: var(--fs-sm); }
.phone .empty { border-radius: var(--radius-bar); }
</style>
