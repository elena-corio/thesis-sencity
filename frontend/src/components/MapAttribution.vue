<script setup>
// Credits (brief §2). On a phone they ride on top of the sheet, so they are not a panel of their own there.
// In the walk (board Routes 5) the buildings are credited to the source the API reports for them, via Infrared.city.
import { photoProvider, showsPhotos, showsWalkPhotos } from '../lib/photos.js'
import { useWalkStore } from '../stores/walk.js'

defineProps({ inSheet: Boolean })
const walk = useWalkStore()
</script>

<template>
  <p class="attribution" :data-panel="inSheet ? undefined : 'attribution'">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
    · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
    <!-- The photos' source: in the walk, and on the cards when they show photos. -->
    <span v-if="walk.active ? showsWalkPhotos() : showsPhotos()"> · photo: {{ photoProvider().name }}</span>
    <span v-if="walk.active && walk.buildingsSource"> · buildings: {{ walk.buildingsSource }} via Infrared.city</span>
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
