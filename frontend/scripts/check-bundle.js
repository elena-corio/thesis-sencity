// After `npm run build`: no secret may be in the built app (Elena, 2026-11-22). Looks in frontend/dist for the value of
// every non-VITE_ variable of the repo's .env (and of the environment, on Render), and for secret key patterns.
// Prints only the variable's name, never its value. Exit 1 if anything is found.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
if (!existsSync(dist)) {
  console.error('No dist/: run npm run build first.')
  process.exit(2)
}
const envFile = new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fromFile = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf-8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
  : {}
const all = { ...fromFile, ...process.env }
const NOT_SECRET = new Set(['PHOTO_SOURCE', 'NODE_VERSION', 'PYTHON_VERSION', 'PLAYWRIGHT', 'NODE_ENV'])
const secrets = Object.entries(all).filter(([k, v]) => !k.startsWith('VITE_') && !NOT_SECRET.has(k) && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(k) && v && v.length >= 12)
const PATTERNS = [/sk_(live|test)_[A-Za-z0-9]{10,}/, /sk-or-v1-[a-f0-9]{20,}/, /postgres(ql)?:\/\/[^"'\s]+:[^"'\s]+@/]

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}
let found = 0
for (const f of files(dist)) {
  const text = readFileSync(f, 'utf-8')
  for (const [name, value] of secrets) {
    if (text.includes(value)) { console.error(`SECRET FOUND: the value of ${name} is in ${f}`); found++ }
  }
  for (const re of PATTERNS) {
    if (re.test(text)) { console.error(`SECRET PATTERN FOUND: ${re} in ${f}`); found++ }
  }
}
console.log(found ? `${found} problem(s).` : `No secret in dist/ (${secrets.length} secret values and ${PATTERNS.length} patterns checked).`)
process.exit(found ? 1 : 0)
