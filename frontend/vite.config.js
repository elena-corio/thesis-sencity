import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import devApi from './dev-api.js'

export default defineConfig({
  plugins: [vue(), devApi()],
  // npm run dev opens the map in the browser (not when Playwright starts it for its checks).
  // /api goes to the SenCity API (python -m app, port 8000), so the browser only talks to one origin.
  server: {
    port: 5173,
    open: process.env.PLAYWRIGHT ? false : '/map',
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  // MapLibre 6 loads its web worker from a file next to it; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { include: ['src/**/*.test.js'] },
})
