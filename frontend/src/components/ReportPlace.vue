<script setup>
// The report's place (board 8b, "A place you looked at"): the photo already on the place card (never fetched again: if
// it is not loaded there, an empty frame says "Photo not available"), its credit under it, the name and type, the
// overall level and what decides it, the Thermal and Senses parts, what might bother or feel good, and whether the
// rating is personal (V2) or general (V0). From the values already here: no new call.
import { computed } from 'vue'
import { overallOf, overallReason } from '../lib/overall.js'
import { photoCredit } from '../lib/photos.js'
import { typeLabel } from '../lib/place.js'
import { stateWord } from '../lib/report.js'
import { predictionLabel } from '../lib/senses.js'
import { formatDegrees, isCold } from '../lib/thermal.js'
import { useProfileStore } from '../stores/profile.js'
import { useSensesStore } from '../stores/senses.js'

const props = defineProps({
  feature: { type: Object, required: true },
  layer: { type: String, required: true },
  info: { type: Object, default: null },
  /** The photo on the place card, and its image as loaded there; null when not loaded. */
  photo: { type: Object, default: null },
  src: { type: String, default: null },
})
const profile = useProfileStore()
const senses = useSensesStore()
const p = computed(() => props.feature.properties)
const type = computed(() => typeLabel(p.value, props.feature.geometry.type))
const photos = computed(() => p.value.photos ?? [])
/** The credit even without the image: the card's photo, else the one the card would open on. */
const creditPhoto = computed(() => props.photo ?? photos.value[senses.placeFor(photos.value).rep ?? 0] ?? null)
const place = computed(() => (photos.value.length ? senses.placeFor(photos.value) : null))
const o = computed(() => overallOf(p.value.senses_state, p.value.thermal_state))
const reason = computed(() => overallReason(o.value, {
  utci: p.value.utci, hot: p.value.utci == null || !isCold(p.value.utci), place: place.value,
  comfort: p.value.senses_comfort ?? place.value?.comfort, personal: profile.personal,
}))
/** "because of heat: feels like 34 °C", "based on thermal only": the card's line without its first word. */
const why = computed(() => reason.value.replace(/^(Easy|Mixed|Hard)\s*(·\s*)?/, ''))
const when = computed(() => (props.info ? `${props.info.season}, ${props.info.time}` : ''))
const thermal = computed(() => (stateWord(p.value.thermal_state) && p.value.utci != null
  ? `${stateWord(p.value.thermal_state)}, feels like ${formatDegrees(p.value.utci)}${when.value ? ` (${when.value})` : ''}` : 'No value'))
const sensesText = computed(() => {
  const w = stateWord(p.value.senses_state)
  if (w) return `${w}, ${p.value.senses_comfort ?? place.value?.comfort} of 5`
  return photos.value.length ? 'Not rated' : 'No photo'
})
const names = (list) => (list ?? []).map((e) => e.en).join(', ')
const rated = computed(() => place.value?.status === 'rated')
const along = computed(() => (props.feature.geometry.type === 'Polygon' ? 'in this place' : 'along this street'))
const based = computed(() => rated.value && `Based on ${place.value.nRated} photo${place.value.nRated === 1 ? '' : 's'} ${along.value}.`)
const stale = computed(() => senses.runs.area.stale || senses.runs.routes.stale)
</script>

<template>
  <section class="place" data-section="place" aria-labelledby="report-place-title">
    <h2 id="report-place-title">A place you looked at</h2>
    <div class="grid">
      <figure class="photo-col">
        <img v-if="src" class="photo" :src="src" :alt="`Street photo of ${p.name}`" data-testid="report-photo" />
        <div v-else class="photo empty" data-testid="report-photo-empty">{{ creditPhoto ? 'Photo not available' : 'No photo' }}</div>
        <figcaption v-if="creditPhoto" class="credit">{{ photoCredit(creditPhoto) || 'Street photo' }}</figcaption>
      </figure>
      <div class="facts">
        <p class="name"><strong lang="de">{{ p.name }}</strong>, {{ type.toLowerCase() }}</p>
        <p v-if="o.state" class="level"><i :class="['sw', o.state]" /><span><strong>Overall {{ stateWord(o.state).toLowerCase() }}</strong>, {{ why }}</span></p>
        <dl>
          <div><dt>Thermal</dt><dd>{{ thermal }}</dd></div>
          <div><dt>Senses</dt><dd>{{ sensesText }}</dd></div>
          <div v-if="rated && place.bothers.length"><dt>Might bother you</dt><dd>{{ names(place.bothers) }}</dd></div>
          <div v-if="rated && place.feelsGood.length"><dt>Might feel good</dt><dd>{{ names(place.feelsGood) }}</dd></div>
        </dl>
        <p class="muted">{{ based || '' }} {{ predictionLabel(profile.personal, stale) }}.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.place { display: flex; flex-direction: column; gap: var(--space-3); }
.grid { display: grid; grid-template-columns: var(--report-photo-w) 1fr; gap: var(--report-gap); align-items: start; }
.photo-col { display: flex; flex-direction: column; gap: var(--space-1); }
.photo { width: var(--report-photo-w); height: var(--report-photo-h); border-radius: var(--radius-btn); object-fit: cover; display: block; }
.photo.empty {
  display: grid; place-items: center; box-sizing: border-box; border: var(--hairline) dashed var(--report-muted);
  color: var(--report-muted); background: var(--report-soft);
}
.credit { font-size: var(--report-fs-xs); color: var(--report-muted); overflow-wrap: anywhere; }
.facts { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.name { font-size: var(--report-fs-lead); }
.level { display: flex; align-items: center; gap: var(--space-2); }
.level span { color: var(--report-ink); }
.sw { display: inline-block; width: var(--report-swatch-w); height: var(--report-swatch-h); border-radius: var(--radius-pill); background: var(--c); }
.sw.easy { --c: var(--report-easy); }
.sw.mixed { --c: var(--report-mixed); }
.sw.hard { --c: var(--report-hard); }
dl { margin: 0; display: flex; flex-direction: column; gap: var(--space-1); }
dl div { display: grid; grid-template-columns: var(--report-label-w) 1fr; gap: var(--space-3); }
dt { color: var(--report-muted); }
dd { margin: 0; }
</style>
