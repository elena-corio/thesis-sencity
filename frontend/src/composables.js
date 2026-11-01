import { onBeforeUnmount, ref } from 'vue'

/** Reactive media query. */
export function useMedia(query) {
  const mql = window.matchMedia(query)
  const matches = ref(mql.matches)
  const onChange = (e) => { matches.value = e.matches }
  mql.addEventListener('change', onChange)
  onBeforeUnmount(() => mql.removeEventListener('change', onChange))
  return matches
}

/** Read a CSS custom property from <html> (map code takes its colours from style.css). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
