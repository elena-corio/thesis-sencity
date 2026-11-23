// A message when something did not work (Elena, 2026-11-23: "if something does not work, as the report before, show a
// message"). Unexpected errors (lib/errors.js) land here instead of failing silently; AppNotice.vue shows it.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const GENERIC = 'Something did not work. Try again; if it keeps happening, reload the page.'
const HIDE_MS = 10000

export const useNoticeStore = defineStore('notice', () => {
  const message = ref('')
  let timer = null
  function show(text = GENERIC) {
    message.value = text
    clearTimeout(timer)
    timer = setTimeout(hide, HIDE_MS)
  }
  function hide() {
    clearTimeout(timer)
    message.value = ''
  }
  return { message, show, hide }
})
