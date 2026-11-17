// The printable report (ReportView, boards 8 and 8b): open or not, and where focus goes back when it closes.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useReportStore = defineStore('report', () => {
  const open = ref(false)
  /** Maps still being drawn: Print waits for them. */
  const pending = ref(0)
  /** What had focus when the report opened: focus goes back there when it closes. */
  let opener = null

  function openReport() {
    opener = document.activeElement
    open.value = true
  }
  function closeReport() {
    open.value = false
    const el = opener
    opener = null
    if (el?.isConnected) el.focus()
  }
  return { open, pending, openReport, closeReport }
})
