<script setup>
import { useThemeStore } from './stores/theme.js'
import AppNotice from './components/AppNotice.vue'

// Starts following the system theme and applies the saved override.
useThemeStore()
</script>

<template>
  <RouterView />
  <AppNotice />
</template>
