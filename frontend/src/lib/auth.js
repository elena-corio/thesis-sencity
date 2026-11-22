// Sign-in in the browser (Elena, 2026-11-22): Clerk (@clerk/vue), email code only. The session is checked again on the
// server for every /api call (backend/app/auth.py); this file only gets the token and knows whether someone is signed
// in. Only the publishable key (public by design) is in the bundle: no secret ever is.
//
// VITE_AUTH=off: the development server for the browser tests only (no Clerk, the profile stays in this browser as in
// phase 1). `npm run build` refuses it (vite.config.js), so no public build can run without sign-in.
import { getToken } from '@clerk/vue'

// Outside Vite (the browser tests import some app files in Node) there is no import.meta.env: sign-in off there.
const env = import.meta.env ?? { VITE_AUTH: 'off' }
export const AUTH_ON = env.VITE_AUTH !== 'off'
export const PUBLISHABLE_KEY = env.VITE_CLERK_PUBLISHABLE_KEY ?? ''
/** Where the person's things are kept, for the words on screen. */
export const KEPT = AUTH_ON ? 'in your account' : 'on this device'

const clerk = () => (typeof window !== 'undefined' ? window.Clerk : null)

/** Resolves once Clerk has loaded (or at once when sign-in is off). */
export function ready(timeoutMs = 15000) {
  if (!AUTH_ON) return Promise.resolve()
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (clerk()?.loaded || Date.now() - started > timeoutMs) resolve()
      else setTimeout(tick, 50)
    }
    tick()
  })
}

/** Someone is signed in (always true when sign-in is off). */
export const isSignedIn = () => !AUTH_ON || !!clerk()?.user

/** The session token for the API, or null. */
export async function token() {
  if (!AUTH_ON) return null
  try {
    return (await getToken()) ?? null
  } catch {
    return null
  }
}

/** fetch with the session token. */
export async function authFetch(url, options = {}) {
  const t = await token()
  const headers = { ...(options.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }
  return fetch(url, { ...options, headers, credentials: 'same-origin' })
}

/** Sign out of Clerk; resolves when done. */
export async function signOut() {
  if (AUTH_ON) await clerk()?.signOut()
}
