import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// MapLibre's worker, as a file of the build (2026-11-28): MapLibre 6 looks for it by name next to its own module, which
// a built app does not have, so the deployed map stayed blank. ?url makes Vite copy it into dist/assets.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import './styles/style.css'
import App from './App.vue'
import router from './router.js'
import { clerkPlugin } from '@clerk/vue'
import { AUTH_ON, PUBLISHABLE_KEY } from './lib/auth.js'
import { watchErrors } from './lib/errors.js'

// Remember whether the last input was the keyboard or a pointer (for focus outlines on text fields).
const setInput = (kind) => { document.documentElement.dataset.input = kind }
window.addEventListener('keydown', (e) => { if (e.key === 'Tab') setInput('keyboard') }, true)
window.addEventListener('pointerdown', () => setInput('pointer'), true)

setWorkerUrl(mapWorkerUrl) // before any map is made

const app = createApp(App).use(createPinia())
// Something that does not work shows a message instead of failing silently (Elena, 2026-11-23).
watchErrors(app)
// Sign-in (Elena, 2026-11-22): Clerk, email code only (set in the Clerk dashboard). The publishable key is public.
if (AUTH_ON) {
  if (!PUBLISHABLE_KEY) console.error('VITE_CLERK_PUBLISHABLE_KEY is missing: sign-in cannot start.')
  app.use(clerkPlugin, { publishableKey: PUBLISHABLE_KEY, signInUrl: '/sign-in', signUpUrl: '/sign-in', afterSignOutUrl: '/welcome' })
}
app.use(router).mount('#app')
