// About and the first-time hints (lib/help.js): whether About is open and at which section, and which hints were seen.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ABOUT_SECTIONS, TIP_GROUPS, currentTip, groupOf, readSeen, writeSeen } from '../lib/help.js'

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

  /** The tips whose part is on screen now (FirstHint registers itself). */
  const shown = ref([])
  /** Next was pressed with the focus on it: the next tip takes the focus. */
  const handoff = ref(false)
  const register = (id) => { if (!shown.value.includes(id)) shown.value = [...shown.value, id] }
  const unregister = (id) => { shown.value = shown.value.filter((x) => x !== id) }

  const isNew = (id) => !seen.value.includes(id)
  /** Show this tip now: not seen, and in a group only when it is the group's current one. */
  function showing(id) {
    const g = groupOf(id)
    return g ? currentTip(g, seen.value, shown.value) === id : isNew(id)
  }
  /** "Tip 2 of 4" among the group's tips on screen, or null for a tip on its own. */
  function position(id) {
    const g = groupOf(id)
    if (!g) return null
    const here = TIP_GROUPS[g].filter((x) => shown.value.includes(x))
    return { n: here.indexOf(id) + 1, of: here.length, last: here.at(-1) === id }
  }
  function dismiss(id) {
    seen.value = [...seen.value, id]
    writeSeen(seen.value)
  }
  /** "Skip tips": the rest of the group too. */
  function skipGroup(id) {
    const g = groupOf(id)
    seen.value = [...seen.value, ...(g ? TIP_GROUPS[g] : [id])]
    writeSeen(seen.value)
  }
  /** "Show tips again" and "Delete my profile": every hint shows again. */
  function clearSeen() {
    seen.value = []
    writeSeen([])
  }

  return { aboutOpen, section, openAbout, closeAbout, seen, shown, handoff, register, unregister, isNew, showing, position, dismiss, skipGroup, clearSeen }
})
