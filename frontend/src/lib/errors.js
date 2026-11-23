// Unexpected errors (Elena, 2026-11-23): a click that fails (a component that cannot draw, an action that throws) shows
// a message (stores/notice.js) instead of doing nothing; the error itself goes to the browser console, never to the
// server. Cancelled requests (AbortError) are not errors.
import { useNoticeStore } from '../stores/notice.js'

const ignored = (err) => err?.name === 'AbortError'

export function watchErrors(app) {
  const notice = useNoticeStore()
  app.config.errorHandler = (err, _instance, info) => {
    console.error(`SenCity: ${info}`, err)
    if (!ignored(err)) notice.show()
  }
  window.addEventListener('unhandledrejection', (e) => {
    if (ignored(e.reason)) return
    console.error('SenCity: unhandled', e.reason)
    notice.show()
  })
}
