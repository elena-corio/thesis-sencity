import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import devApi from './dev-api.js'

// PHOTO_SOURCE (Elena, 2026-11-16): the same setting as the API's, from the environment or the repo's .env.
// 'streetview' (the default) is for the local prototype only: a production build (npm run build) refuses it until
// Google's terms are checked, so any public site is built with PHOTO_SOURCE=mapillary.
export default defineConfig(({ command, mode }) => {
  const photoSource = (process.env.PHOTO_SOURCE || loadEnv(mode, '..', 'PHOTO_SOURCE').PHOTO_SOURCE || 'streetview')
    .trim().toLowerCase()
  if (!['streetview', 'mapillary'].includes(photoSource)) {
    throw new Error(`PHOTO_SOURCE must be streetview or mapillary, not "${photoSource}".`)
  }
  if (command === 'build' && !process.env.VITEST && photoSource === 'streetview') {
    throw new Error('PHOTO_SOURCE=streetview is for the local prototype only. Public builds use Mapillary until '
      + "Google's terms are checked: build with PHOTO_SOURCE=mapillary (and set it on the API too).")
  }
  // Sign-in (Elena, 2026-11-22): VITE_AUTH=off is for the browser tests' development server only, and a build needs the
  // Clerk publishable key (public by design). Only VITE_* names reach the browser: CLERK_SECRET_KEY and every API key
  // in the same .env never do (checked after each build: npm run check:bundle).
  const env = { ...loadEnv(mode, '..', 'VITE_'), ...process.env }
  if (command === 'build' && !process.env.VITEST) {
    if ((env.VITE_AUTH || '').trim() === 'off') throw new Error('VITE_AUTH=off is for the tests only: a build always signs in.')
    if (!(env.VITE_CLERK_PUBLISHABLE_KEY || '').trim()) throw new Error('VITE_CLERK_PUBLISHABLE_KEY is missing: set it in .env or on Render.')
  }
  return {
    envDir: '..', // the repo's .env (VITE_* only are exposed)
    plugins: [vue(), devApi()],
    define: { 'import.meta.env.PHOTO_SOURCE': JSON.stringify(photoSource) },
    // npm run dev opens the map in the browser (not when Playwright starts it for its checks).
    // /api goes to the SenCity API (python -m app, port 8000), so the browser only talks to one origin.
    server: {
      port: 5173,
      open: process.env.PLAYWRIGHT ? false : '/area',
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
    // MapLibre 6 loads its web worker from a file next to it; pre-bundling breaks that path.
    optimizeDeps: { exclude: ['maplibre-gl'] },
    // The unit tests run without Clerk, as the browser tests do; stores/account.test.js checks the account path.
    test: { include: ['src/**/*.test.js'], env: { VITE_AUTH: 'off' } },
  }
})
