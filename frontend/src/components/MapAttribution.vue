<script setup>
// Credits (brief §2). Inside the phone sheet it scrolls with the sheet, so it is not a panel there.
defineProps({ inSheet: Boolean })
</script>

<template>
  <p class="attribution" :data-panel="inSheet ? undefined : 'attribution'">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
    · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
    · thermal: Infrared.city
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
