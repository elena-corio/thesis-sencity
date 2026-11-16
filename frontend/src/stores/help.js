// About and the first-time hints (lib/help.js): whether About is open and at which section, and which hints were seen.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ABOUT_SECTIONS, readSeen, writeSeen } from '../lib/help.js'

export const useHelpStore = defineStore('help', () => {
  const aboutOpen = ref(false)
  /** The section About opens at (a "How this works" link), or null for the top. */
  const section = ref(null)
  /** What had focus when About opened: focus goes back there when it closes. */
  let opener = null
  const seen = ref(readSeen())

  function openAbout(at = null) {
    opener = document.activeElement
    section.value = ABOUT_SECTIONS.includes(at) ? at : null
    aboutOpen.value = true
  }
  function closeAbout() {
    aboutOpen.value = false
    const el = opener
    opener = null
    if (el?.isConnected) el.focus()
  }

  const isNew = (id) => !seen.value.includes(id)
  function dismiss(id) {
    seen.value = [...seen.value, id]
    writeSeen(seen.value)
  }
  /** "Show tips again" and "Delete my profile": every hint shows again. */
  function clearSeen() {
    seen.value = []
    writeSeen([])
  }

  return { aboutOpen, section, openAbout, closeAbout, seen, isNew, dismiss, clearSeen }
})
