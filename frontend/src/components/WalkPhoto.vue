<script setup>
// The photo of the stretch ahead (boards Routes 5, P6): one square photo, centred, facing along the walk, so it reads as
// a window onto the 3D street behind it. No enlarge, no arrows, no labels: only the credit. With no photo along the
// stretch the centre shows the 3D street and says so (Elena, 2026-11-11). With photos not shown (lib/photos.js) it shows
// the 3D street alone. Images are loaded when shown, never stored.
import { computed, ref, watch } from 'vue'
import { photoCredit, shownPhotoUrl } from '../lib/photos.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const failed = ref(false)
const name = computed(() => walk.feature?.properties.name ?? 'the street')
const noPhoto = computed(() => walk.current && walk.photos.length === 0 && walk.feature?.properties.photos != null)
watch(() => walk.photo, () => { failed.value = false })
</script>

<template>
  <div class="walk-photo" :class="{ phone }">
    <figure v-if="walk.photo && !failed" class="frame" aria-label="Street View photo of the stretch ahead" data-testid="walk-photo">
      <img :src="shownPhotoUrl(walk.photo)" :alt="`Street View photo at eye level, looking along ${name}`" @error="failed = true" />
      <span class="credit">{{ photoCredit(walk.photo) }}</span>
    </figure>
    <p v-else-if="noPhoto" class="no-photo panel" role="status" data-testid="walk-no-photo">No photo for this stretch, rated from the map.</p>
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
.credit {
  position: absolute; right: var(--space-2); bottom: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-chip);
  background: var(--photo-btn-bg); color: var(--photo-btn-fg); box-shadow: var(--photo-btn-shadow); font-size: var(--fs-xs);
}
.no-photo { margin: 0 0 var(--space-3); padding: var(--space-2) var(--space-4); border-radius: var(--radius-btn); font-size: var(--fs-sm); text-align: center; }
.phone .no-photo { margin-bottom: var(--space-2); font-size: var(--fs-xs); }
</style>
