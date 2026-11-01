<script setup>
import { useThemeStore } from './stores/theme.js'

// Starts following the system theme and applies the saved override.
useThemeStore()
</script>

<template>
  <RouterView />
</template>
