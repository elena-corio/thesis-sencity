<script setup>
// Line icons drawn in currentColor (24 × 24 grid).
const PATHS = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5h.01'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  print: ['M7 9V3h10v6', 'M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2', 'M7 14h10v7H7z'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  chat: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  expand: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
  cameraOff: ['M3 3l18 18', 'M9.5 5H15l1.5 2H20a1 1 0 0 1 1 1v9', 'M17.5 19H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3', 'M9.5 10.5a3 3 0 0 0 4 4'],
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.5l2.5 2.5L16 9.5'],
  pending: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z'],
  minus: ['M5 12h14'],
  locate: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4'],
  crosshair: ['M12 3v6', 'M12 15v6', 'M3 12h6', 'M15 12h6'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2-2 5 5', 'M15 9.5a1 1 0 1 0 0-.01'],
  thermometer: ['M12 14V4', 'M12 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  // Area tab (board P1): dashed circle, centre dot, radius line to the edge handle
  area: [
    'M19.79 10.2A8 8 0 0 1 19.79 13.8', 'M18.78 16.24A8 8 0 0 1 16.24 18.78', 'M13.8 19.79A8 8 0 0 1 10.2 19.79',
    'M7.76 18.78A8 8 0 0 1 5.22 16.24', 'M4.21 13.8A8 8 0 0 1 4.21 10.2', 'M5.22 7.76A8 8 0 0 1 7.76 5.22',
    'M10.2 4.21A8 8 0 0 1 13.8 4.21', 'M17.66 8.34a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M13.27 10.73L16.24 7.76',
    'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  ],
  route: ['M6 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M8.5 18.5H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  logout: ['M10 4H5v16h5', 'M14 8l-4 4 4 4', 'M10 12h11'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronUp: ['M6 15l6-6 6 6'],
  swap: ['M8 20V5', 'M4 9l4-4 4 4', 'M16 4v15', 'M20 15l-4 4-4-4'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4z'],
}

defineProps({ name: { type: String, required: true } })
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-for="(d, i) in PATHS[name]" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.icon { width: var(--icon); height: var(--icon); stroke-width: var(--icon-stroke); flex: none; }
</style>
