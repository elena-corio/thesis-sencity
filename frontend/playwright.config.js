import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    // The first-time tips start as seen, so other tests see the app as before; e2e/about.spec.js clears this.
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'sencity-tips-seen', value: '["map","place","routes","walk","profile"]' }] }],
    },
    // MapLibre needs WebGL in headless Chromium.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/area',
    reuseExistingServer: true,
    env: { PLAYWRIGHT: '1' }, // keeps vite.config.js from opening a browser window
    timeout: 60_000,
  },
})
