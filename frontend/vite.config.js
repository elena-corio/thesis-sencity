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
  return {
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
    test: { include: ['src/**/*.test.js'] },
  }
})
