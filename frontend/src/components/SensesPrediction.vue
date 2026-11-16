<script setup>
// One place on the Senses layer (board 2c), from the ratings already here, with no new call: waiting, could not
// be rated (with Retry), or the rating on its 1–5 bar, what might bother and feel good with sense icons, and the
// model's explanation of the photo shown. Model text is shown as text only.
import { computed } from 'vue'
import { predictionLabel, bySense, comfortLabel, levelWord } from '../lib/senses.js'
import AppIcon from './AppIcon.vue'
import SenseItem from './SenseItem.vue'
import { useProfileStore } from '../stores/profile.js'
import { useSensesStore } from '../stores/senses.js'
import HowLink from './HowLink.vue'

const props = defineProps({
  /** The place, combined from its photos (lib/senses.js). */
  place: { type: Object, required: true },
  /** The rating of the photo on the card, if it has one. */
  shown: { type: Object, default: null },
  photoNumber: { type: Number, default: 1 },
  /** "along this street" or "in this place" */
  along: { type: String, default: 'along this street' },
})
defineEmits(['retry'])
const lists = computed(() => [
  { title: 'Might bother', kind: 'bother', rows: bySense(props.place.bothers) },
  { title: 'Might feel good', kind: 'good', rows: bySense(props.place.feelsGood) },
])
const reason = computed(() => (props.shown?.status === 'ok' ? props.shown.result.reason : props.place.reason))
const basedOn = computed(() => {
  const { nRated, nFailed, nPending } = props.place
  const notes = []
  if (nPending) notes.push(`${nPending} still being rated`)
  if (nFailed) notes.push(`${nFailed} could not be rated`)
  return `Based on ${nRated} photo${nRated === 1 ? '' : 's'} ${props.along}${notes.length ? ` (${notes.join(', ')})` : ''}.`
})
const showPhotoLine = computed(() => props.place.nPhotos > 1 && props.shown?.status === 'ok')
const profileStore = useProfileStore()
const senses = useSensesStore()
const stale = computed(() => senses.runs.area.stale || senses.runs.routes.stale)
</script>

<template>
  <p v-if="place.status === 'pending'" class="waiting" role="status">
    <span class="spinner" aria-hidden="true" /> Waiting for its rating…
  </p>

  <div v-else-if="place.status === 'failed'" class="failed" role="alert" data-testid="senses-error">
    <p class="failed-title"><AppIcon name="info" /> Couldn’t rate this photo</p>
    <p class="failed-text">{{ place.error }}</p>
    <p class="muted">The photo and the map still work.</p>
    <button type="button" class="btn btn-primary" @click="$emit('retry')">Retry</button>
  </div>

  <div v-else data-testid="senses-result">
    <div class="scale">
      <div class="scale-head">
        <span>Senses · comfort from photo, {{ profileStore.personal ? 'personal' : 'general' }}</span>
        <strong><span :class="['state', place.level]">{{ levelWord(place.level) }}</span> · {{ comfortLabel(place) }}</strong>
      </div>
      <div class="track" role="img" :aria-label="`Comfort ${place.comfort} of 5`">
        <span class="diamond" :style="{ left: `${((place.comfort - 1) / 4) * 100}%` }" />
      </div>
      <div class="ticks" aria-hidden="true"><span v-for="n in 5" :key="n">{{ n }}</span></div>
      <p class="general">{{ predictionLabel(profileStore.personal, stale) }}</p>
    </div>
    <p class="based muted" data-testid="senses-based">{{ basedOn }}</p>

    <section v-for="l in lists" :key="l.kind" class="list">
      <h3>{{ l.title }}</h3>
      <ul v-if="l.rows.length" :class="l.kind">
        <SenseItem v-for="r in l.rows" :key="r.sense" :row="r" :kind="l.kind" />
      </ul>
      <p v-else class="muted">Nothing named in enough of the photos.</p>
    </section>

    <section class="list">
      <!-- The model's words, as plain text under this line (Elena, 2026-11-15). -->
      <h3>A prediction, not a reason</h3>
      <p v-if="showPhotoLine" class="muted">Photo {{ photoNumber }}: {{ comfortLabel(shown.result) }}</p>
      <p class="reason">{{ reason }}</p>
      <HowLink section="ratings" />
    </section>
  </div>
</template>

<style scoped>
p { margin: 0; }
.muted { margin-top: var(--space-1); font-size: var(--fs-sm); color: var(--text-2); }
.waiting { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); color: var(--text-2); }
.spinner {
  flex: none; width: var(--icon); height: var(--icon);
  border: var(--focus-width) solid var(--line); border-top-color: var(--text); border-radius: 50%;
  animation: spin var(--senses-spin-s) linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-style: dashed; } }

.failed {
  margin-top: var(--space-4); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--warning); border-radius: var(--radius-btn);
}
.failed-title { display: flex; align-items: center; gap: var(--space-2); font-weight: var(--fw-semibold); }
.failed-text { margin-top: var(--space-2); overflow-wrap: anywhere; }
.failed .btn { margin-top: var(--space-3); }

.scale {
  margin-top: var(--space-4); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
}
.scale-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1) var(--space-3); font-size: var(--fs-sm); }
.scale-head strong { font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
.state.hard { color: var(--hard-text); }
.track {
  position: relative; height: var(--swatch-h); margin: var(--space-3) var(--space-1) 0; border-radius: var(--radius-pill);
  background: linear-gradient(to right, var(--hard), var(--mixed), var(--easy));
}
.diamond {
  position: absolute; top: 50%; width: var(--handle-size); height: var(--handle-size);
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--ring); border: var(--hairline) solid var(--ring-edge);
}
.ticks {
  display: flex; justify-content: space-between; margin: var(--space-2) var(--space-1) 0;
  font-size: var(--fs-xs); color: var(--text-muted); font-variant-numeric: tabular-nums;
}
.based { margin-top: var(--space-2); }
.list { margin-top: var(--space-4); }
.list h3 { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.list ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.list ul { display: flex; flex-direction: column; gap: var(--space-1); }
.reason { margin-top: var(--space-2); overflow-wrap: anywhere; }
.general { margin-top: var(--space-3); font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
</style>
