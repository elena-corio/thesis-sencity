<script setup>
// The printable report (boards 8 and 8b; brief §7), opened from the print icon (top right) and the account menu: a
// preview of A4 pages over the app, with "Print / Save as PDF" (the browser's own print) and Close. Always light, in
// the print colours, whatever the app's theme. Made in this browser from what is already here (the profile, the area,
// the routes, the ratings, the photo already on the place card): nothing is sent, uploaded or kept. Sections appear
// only with their data (lib/report.js reportSections), in the boards' order, packed onto pages (reportPages).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { areaCounts, inShort, reportDate, reportPages, reportSections, routeVerdict, whyHard } from '../lib/report.js'
import { shownPhotoUrl, sourcesName } from '../lib/photos.js'
import { useAreaStore } from '../stores/area.js'
import { useProfileStore } from '../stores/profile.js'
import { useReportStore } from '../stores/report.js'
import { useRoutesStore } from '../stores/routes.js'
import { useSensesStore } from '../stores/senses.js'
import AppLogo from './AppLogo.vue'
import ReportArea from './ReportArea.vue'
import ReportPlace from './ReportPlace.vue'
import ReportProfile from './ReportProfile.vue'
import ReportRoute from './ReportRoute.vue'

const report = useReportStore()
const profile = useProfileStore()
const area = useAreaStore()
const routes = useRoutesStore()
const route = useRoute()

const hasArea = computed(() => area.step === 'analysed' && area.load === 'ready' && !!area.rated?.features?.length)
const hasRoute = computed(() => routes.hasResult && routes.load !== 'loading')

/** The place on the card now: a stretch of a route in Routes, else the street selected in Area. */
const place = computed(() => {
  if (route.params.mode === 'routes' && routes.selectedStretch) {
    const f = routes.rated.get(routes.selectedStretch.segmentId)
    return f ? { feature: f, layer: routes.layer, info: routes.info } : null
  }
  if (route.params.mode !== 'routes' && area.selectedId) {
    const f = area.rated?.features.find((x) => x.properties.id === area.selectedId)
    return f ? { feature: f, layer: area.layer, info: area.thermalInfo } : null
  }
  return null
})
/** The photo already on the place card, only if it has loaded: never fetched again for the report. */
const cardPhoto = ref(null)
function readCardPhoto() {
  const img = document.querySelector('[data-panel="place-card"] .photo img')
  const photos = place.value?.feature.properties.photos ?? []
  const src = img?.getAttribute('src')
  const photo = photos.find((ph) => shownPhotoUrl(ph) === src) ?? null
  cardPhoto.value = photo && img.complete && img.naturalWidth > 0 ? { photo, src } : null
}

const sections = computed(() => reportSections({ profile: !!profile.profile, area: hasArea.value, route: hasRoute.value, place: !!place.value }))
const pages = computed(() => reportPages(sections.value))
const date = reportDate()
const personal = computed(() => !!profile.profile)

// "In short" (board 8): the area in one sentence, then the routes' verdict as on the route card.
const senses = useSensesStore()
const bothersOf = (f) => (f.properties.photos?.length ? (senses.placeFor(f.properties.photos).bothers ?? []).map((e) => e.en) : [])
const inShortText = computed(() => {
  const fs = area.rated?.features ?? []
  return inShort({
    area: hasArea.value ? { name: area.centreLabel || null, counts: areaCounts(fs, area.layer), why: whyHard(fs, area.layer, bothersOf) } : null,
    route: hasRoute.value ? routeVerdict(routes.layer, routes.shown, routes.verdict) : '',
    personal: personal.value,
  })
})

const box = ref(null)
const title = ref(null)
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    report.closeReport()
    return
  }
  if (e.key !== 'Tab') return
  const items = [...box.value.querySelectorAll('button:not([disabled]), [href], [tabindex="-1"]#report-title')]
  if (!items.length) return
  const first = items[0]
  const last = items.at(-1)
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
function print() {
  if (report.pending) return
  window.print()
}

onMounted(async () => {
  readCardPhoto()
  if (profile.profile) profile.ensureSurvey() // the questions (part_a.json, nothing personal), for the radar
  await nextTick()
  title.value?.focus()
})
onBeforeUnmount(() => { report.pending = 0 })
</script>

<template>
  <div ref="box" class="report" data-report role="dialog" aria-modal="true" aria-labelledby="report-title" @keydown="onKey">
    <div class="toolbar">
      <h2 id="report-title" ref="title" tabindex="-1">Report preview</h2>
      <span class="count">{{ pages.length }} page{{ pages.length === 1 ? '' : 's' }}, A4</span>
      <span v-if="report.pending" class="status" role="status">Drawing the maps…</span>
      <button type="button" class="btn btn-primary" :aria-disabled="report.pending > 0" data-testid="report-print" @click="print">
        Print / Save as PDF
      </button>
      <button type="button" class="btn" @click="report.closeReport()">Close</button>
    </div>

    <div class="pages">
      <article v-for="(page, i) in pages" :key="i" class="page" :aria-label="`Page ${i + 1} of ${pages.length}`" :data-page="i + 1">
        <header v-if="i === 0" class="head">
          <AppLogo class="logo" />
          <div class="head-text">
            <h1>Your SenCity report</h1>
            <p class="sub">How places in Vienna may feel{{ personal ? ' for you' : '' }}. Predictions, not reasons.</p>
          </div>
          <p class="date">{{ date }}</p>
        </header>
        <header v-else class="head small">
          <AppLogo class="logo" />
          <p class="head-title">Your SenCity report</p>
          <p class="date">{{ date }}</p>
        </header>

        <div class="body">
          <template v-for="id in page" :key="id">
            <section v-if="id === 'inShort'" class="in-short" data-section="inShort">
              <h2 class="label">In short</h2>
              <p data-testid="report-in-short">{{ inShortText }}</p>
            </section>
            <ReportProfile v-else-if="id === 'profile'" />
            <section v-else-if="id === 'noProfile'" class="note" data-section="noProfile">
              <p><strong>No personal profile: results are general.</strong> Create your profile in SenCity to see how places may feel for you.</p>
            </section>
            <ReportArea v-else-if="id === 'area'" />
            <ReportRoute v-else-if="id === 'route'" />
            <ReportPlace v-else-if="id === 'place'" :feature="place.feature" :layer="place.layer" :info="place.info"
                         :photo="cardPhoto?.photo ?? null" :src="cardPhoto?.src ?? null" />
            <section v-else-if="id === 'made'" class="made" data-section="made">
              <h2>How this was made</h2>
              <p>
                Photo ratings come from an AI model reading street photos{{ personal ? ' with your profile' : ' for a general visitor' }}.
                Thermal comfort comes from a climate simulation by Infrared.city for the chosen season and time, read with
                {{ personal ? 'your own limits' : 'the standard limits' }}. These are predictions, not reasons: they can be
                wrong for you, a photo shows one moment, and streets without a photo are not rated.
                Street photos: {{ sourcesName() }}. Map: © OpenStreetMap contributors, OpenFreeMap.
                SenCity is part of a master thesis final project.
              </p>
            </section>
          </template>
        </div>

        <footer class="foot">
          <span>SenCity gives a prediction, not advice. Check the place yourself.</span>
          <span>Page {{ i + 1 }} of {{ pages.length }}</span>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.report {
  position: fixed; inset: 0; z-index: 50; overflow: auto;
  background: var(--ground); color: var(--text);
}
.toolbar {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3);
  padding: var(--space-3) var(--margin); background: var(--panel); border-bottom: var(--hairline) solid var(--line);
}
.toolbar h2 { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.toolbar .count { color: var(--text-2); font-size: var(--fs-sm); flex: 1; }
.toolbar .status { color: var(--text-2); font-size: var(--fs-sm); }
.toolbar .btn[aria-disabled="true"] { opacity: var(--inactive-opacity); cursor: progress; }
.pages { display: flex; flex-direction: column; align-items: center; gap: var(--space-5); padding: var(--space-5) var(--space-4); }

/* One A4 sheet, always light (the report's own tokens). */
.page {
  --logo: var(--report-logo-color);
  position: relative; display: flex; flex-direction: column; flex: none;
  width: var(--report-page-w); height: var(--report-page-h); padding: var(--report-margin);
  box-sizing: border-box; overflow: hidden;
  background: var(--report-bg); color: var(--report-ink); box-shadow: var(--shadow);
  font-family: var(--font-sans); font-size: var(--report-fs); line-height: 1.4;
  color-scheme: light;
}
.page :deep(p), .page :deep(h1), .page :deep(h2), .page :deep(h3), .page :deep(ul), .page :deep(figure), .page :deep(blockquote) { margin: 0; }
.page :deep(ul) { padding: 0; list-style: none; }
.page :deep(h2) { font-size: var(--report-fs-h2); font-weight: var(--fw-semibold); color: var(--report-ink); }
.page :deep(.label) {
  font-size: var(--report-fs-sm); font-weight: var(--fw-semibold); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--report-muted);
}
.page :deep(.muted) { color: var(--report-muted); }
.head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-4); margin-bottom: var(--report-gap); }
.head .logo { width: var(--report-logo); height: var(--report-logo); }
.head h1 { font-size: var(--report-fs-title); font-weight: var(--fw-semibold); line-height: 1.1; }
.head .sub { color: var(--report-ink-2); font-size: var(--report-fs-lead); }
.head .date { align-self: start; color: var(--report-ink-2); text-align: right; }
.head.small { margin-bottom: var(--space-4); }
.head.small .logo { width: var(--report-logo-small); height: var(--report-logo-small); }
.head-title { font-size: var(--report-fs-lead); font-weight: var(--fw-semibold); }
.body { flex: 1; display: flex; flex-direction: column; gap: var(--report-gap); min-height: 0; }
.in-short, .note { padding: var(--space-3) var(--space-5); border-radius: var(--radius-btn); background: var(--report-soft); }
.in-short p { margin-top: var(--space-1); font-size: var(--report-fs-lead); line-height: 1.45; }
.made p { margin-top: var(--space-2); color: var(--report-ink-2); }
/* Narrower than a sheet (a phone, a small tablet): the preview shows the pages smaller, so they never scroll sideways.
   Printing is not affected. */
@media screen and (max-width: 859px) {
  .pages { zoom: var(--report-preview-zoom); padding-inline: 0; }
  .toolbar { padding-inline: var(--space-4); }
  .toolbar .count { display: none; }
  .toolbar h2 { flex: 1; }
}
.foot {
  display: flex; justify-content: space-between; gap: var(--space-4); padding-top: var(--space-3); margin-top: var(--space-3);
  border-top: var(--hairline) solid var(--report-line); font-size: var(--report-fs-sm); color: var(--report-muted);
}
</style>

<style>
/* Printing: only the report's pages, each on its own A4 sheet, in their own colours; no app around them. */
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body, #app, .app { height: auto !important; width: auto !important; overflow: visible !important; background: var(--report-bg) !important; }
  .app > :not([data-report]) { display: none !important; }
  [data-report] { position: static !important; overflow: visible !important; background: none !important; }
  [data-report] .toolbar { display: none !important; }
  [data-report] .pages { display: block !important; padding: 0 !important; }
  [data-report] .page { box-shadow: none !important; break-after: page; break-inside: avoid; margin: 0 !important; }
  [data-report] .page:last-child { break-after: auto; }
  [data-report], [data-report] * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
