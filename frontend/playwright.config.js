import { defineConfig } from '@playwright/test'
import { TIP_IDS } from './src/lib/help.js'

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
      origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'sencity-tips-seen', value: JSON.stringify(TIP_IDS) }] }],
    },
    // MapLibre needs WebGL in headless Chromium.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/area',
    reuseExistingServer: true,
    // PLAYWRIGHT keeps vite.config.js from opening a browser window; VITE_AUTH=off runs the app without Clerk (the
    // profile in the browser, as in phase 1), for these checks only: a build refuses it.
    env: { PLAYWRIGHT: '1', VITE_AUTH: 'off' },
    timeout: 60_000,
  },
})
