// Vite plugin: `npm run dev` also starts the SenCity API (python -m app in backend/, port 8000),
// so search works without a second terminal. The API stops when the dev server stops.
// Not used when Playwright runs the checks (they mock the API).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const python = process.platform === 'win32'
  ? resolve(root, '.venv', 'Scripts', 'python.exe')
  : resolve(root, '.venv', 'bin', 'python')

function portInUse(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' }, () => { socket.end(); done(true) })
    socket.on('error', () => done(false))
  })
}

export default function devApi({ port = 8000 } = {}) {
  let child = null
  return {
    name: 'sencity-dev-api',
    apply: 'serve',
    async configureServer(server) {
      if (process.env.PLAYWRIGHT) return
      const log = (msg) => server.config.logger.info(`[api] ${msg}`, { timestamp: true })
      if (await portInUse(port)) {
        log(`already running on port ${port}`)
        return
      }
      if (!existsSync(python)) {
        log(`not started: no Python found at ${python}. See README "Setup". Search will say it is not available.`)
        return
      }
      child = spawn(python, ['-m', 'app', '--port', String(port)], { cwd: resolve(root, 'backend'), stdio: 'inherit' })
      child.on('exit', (code) => {
        if (code) log(`stopped (exit code ${code}). Search will say it is not available.`)
        child = null
      })
      const stop = () => child?.kill()
      server.httpServer?.on('close', stop)
      process.on('exit', stop)
      log(`started on http://127.0.0.1:${port}`)
    },
  }
}
