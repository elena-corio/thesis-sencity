<script setup>
// The photo of the stretch ahead (boards Routes 5, P6): one square photo, centred, facing along the walk, so it reads as
// a window onto the 3D street behind it. No enlarge, no arrows, no labels: only the credit, inside the frame (Mapillary:
// "{username} · {year} · CC BY-SA 4.0", linked to the image page). With no photo for the stretch the centre shows the 3D
// street and says so (Elena, 2026-11-11); with photos not shown (lib/photos.js) the 3D street alone. Images are loaded
// when shown, never stored.
import { computed, ref, watch } from 'vue'
import { panoShift, photoCredit, photoLink, providerName, shownPhotoUrl } from '../lib/photos.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const failed = ref(false)
const name = computed(() => walk.feature?.properties.name ?? 'the street')
const source = computed(() => (providerName() === 'mapillary' ? 'Mapillary' : 'Street View'))
const message = computed(() => {
  if (walk.photoState === 'none-here' || (walk.photoState === 'shown' && failed.value)) return 'No photo for this stretch, rated from the map.'
  if (walk.photoState === 'error') return 'Photos could not be loaded. The walk goes on without them.'
  return ''
})
/** A panorama: the 90 degree view at the walk's bearing, cut from the equirectangular thumbnail (lib/photos.js). */
const panoStyle = computed(() => (walk.photo?.pano ? {
  backgroundImage: `url("${shownPhotoUrl(walk.photo)}")`,
  backgroundPositionX: `calc(${panoShift(walk.photo)} * 100cqw)`,
} : null))
watch(() => walk.photo, () => { failed.value = false })
</script>

<template>
  <div class="walk-photo" :class="{ phone }">
    <figure v-if="walk.photoState === 'shown' && !failed" class="frame" :aria-label="`${source} photo of the stretch ahead`" data-testid="walk-photo">
      <template v-if="panoStyle">
        <div class="pano" role="img" :aria-label="`${source} panorama at eye level, looking along ${name}`" :style="panoStyle" data-testid="walk-pano" />
        <img class="probe" :src="shownPhotoUrl(walk.photo)" alt="" @error="failed = true" />
      </template>
      <img v-else :src="shownPhotoUrl(walk.photo)" :alt="`${source} photo at eye level, looking along ${name}`" @error="failed = true" />
      <a v-if="photoLink(walk.photo)" class="credit" :href="photoLink(walk.photo)" target="_blank" rel="noopener">{{ photoCredit(walk.photo) }}</a>
      <span v-else class="credit">{{ photoCredit(walk.photo) }}</span>
    </figure>
    <p v-else-if="message" class="no-photo panel" role="status" data-testid="walk-no-photo">{{ message }}</p>
  </div>
</template>

<style scoped>
.walk-photo { display: flex; align-items: flex-end; justify-content: center; width: 100%; aspect-ratio: 1; }
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
.no-photo { margin: 0 0 var(--space-3); padding: var(--space-2) var(--space-4); border-radius: var(--radius-btn); font-size: var(--fs-sm); text-align: center; }
.phone .no-photo { margin-bottom: var(--space-2); font-size: var(--fs-xs); }
</style>
