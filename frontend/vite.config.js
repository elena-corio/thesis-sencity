import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // npm run dev opens the map in the browser; not when Playwright starts the server for its checks.
  server: { port: 5173, open: process.env.PLAYWRIGHT ? false : '/map' },
  // MapLibre 6 loads its web worker from a file next to it; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { include: ['src/**/*.test.js'] },
})
