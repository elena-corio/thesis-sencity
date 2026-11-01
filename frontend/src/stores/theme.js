import { defineStore } from 'pinia'
import { computed, ref, watchEffect } from 'vue'

const KEY = 'sencity-appearance'

function readSaved() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Appearance: System (default, follows prefers-color-scheme live), Light or Dark (saved). */
export const useThemeStore = defineStore('theme', () => {
  const preference = ref(readSaved())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media.matches)
  media.addEventListener('change', (e) => { systemDark.value = e.matches })

  const resolved = computed(() =>
    preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value)

  watchEffect(() => { document.documentElement.dataset.theme = resolved.value })

  /** @param {'system'|'light'|'dark'} value */
  function setPreference(value) {
    preference.value = value
    try {
      if (value === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, value)
    } catch {
      // Storage blocked (private mode): the choice lasts for this visit only.
    }
  }

  return { preference, resolved, setPreference }
})
