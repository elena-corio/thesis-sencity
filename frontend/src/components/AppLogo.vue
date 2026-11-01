<script setup>
// SenCity logo: 12 arcs from src/assets/logo/sencity.svg, drawn in var(--logo)
// (white on dark, #15474a on light), never the file's black.
const ARCS = [
  'M142,48.42c-12.32,4.36-18.78,17.88-14.42,30.2,2.38,6.74,7.68,12.04,14.42,14.42',
  'M142,32.08c-21.34,4.36-35.12,25.19-30.76,46.54,3.16,15.49,15.27,27.6,30.76,30.76',
  'M142,16.08c-30.19,4.36-51.12,32.36-46.77,62.54,3.5,24.23,22.53,43.27,46.77,46.77',
  'M142,.17c-38.97,4.36-67.03,39.48-62.67,78.45,3.69,32.97,29.71,58.99,62.67,62.67',
  'M0,141.29c32.97-3.69,58.99-29.71,62.67-62.67',
  'M0,125.39c24.23-3.5,43.27-22.53,46.77-46.77',
  'M0,109.38c15.49-3.16,27.6-15.27,30.76-30.76',
  'M0,93.05c6.74-2.38,12.04-7.68,14.42-14.42',
  'M62.67,48.42c-6.74,2.38-12.04,7.68-14.42,14.42',
  'M62.67,32.08c-15.49,3.16-27.6,15.27-30.76,30.76',
  'M62.67,16.08c-24.23,3.5-43.27,22.53-46.77,46.77',
  'M62.67.17C29.71,3.86,3.69,29.88,0,62.84',
]
</script>

<template>
  <svg class="logo" viewBox="-4 -4 150 150" fill="none" stroke="currentColor" stroke-width="8"
       stroke-linecap="round" stroke-miterlimit="10" role="img" aria-label="SenCity">
    <path v-for="(d, i) in ARCS" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.logo { width: var(--logo-size); height: var(--logo-size); color: var(--logo); flex: none; }
</style>
