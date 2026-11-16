<script setup>
// Credits (brief §2). On a phone they ride on top of the sheet, so they are not a panel of their own there.
import { showsPhotos, sourcesName } from '../lib/photos.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ inSheet: Boolean })
const walk = useWalkStore()
</script>

<template>
  <p class="attribution" :data-panel="inSheet ? undefined : 'attribution'">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
    · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
    <!-- The photos' source: in the walk, the shown photo's; elsewhere the build's (Street View with Mapillary, or Mapillary). -->
    <span v-if="showsPhotos()"> · photo: {{ sourcesName(walk.active ? walk.photo : null) }}</span>
    <span> · thermal: Infrared.city</span>
  </p>
</template>

<style scoped>
.attribution {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-2);
  text-shadow: 0 0 4px var(--ground);
}
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
