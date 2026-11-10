<script setup>
// "Loading this area" (boards Flow 2, Flow 3): the streets, their photos, then thermal comfort (Infrared.city) or the
// rating of the photos. Streets are grey on the map until they have a value, then take its colour. Recommendations
// wait for the end of the rating. Cancel while rating only stops the rating: the area stays.
import { computed, onMounted, ref } from 'vue'
import { GENERAL_LABEL, moneyLine } from '../lib/senses.js'
import { useAreaStore } from '../stores/area.js'
import { useSensesStore } from '../stores/senses.js'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
const area = useAreaStore()
const senses = useSensesStore()
const rating = computed(() => senses.areaProgress)
const cancel = () => (senses.areaRating ? senses.stopHere('area') : area.cancelLoad())
const cancelBtn = ref(null)
// Started with the keyboard: focus Cancel, so Enter or Space can stop it.
onMounted(() => { if (area.byKeyboard) cancelBtn.value?.focus() })

const streetsDone = computed(() => area.load === 'ready' || area.progress.stage !== 'streets')
const photosActive = computed(() => area.load === 'loading' && area.progress.stage !== 'streets')
const photosDetail = computed(() => {
  const p = area.progress
  if (area.load === 'ready') return `${area.counts.all} of ${area.counts.all}`
  return photosActive.value ? `${p.done} of ${p.total}` : ''
})
const share = computed(() => (area.progress.total ? area.progress.done / area.progress.total : 0))
</script>

<template>
  <section class="card panel" :class="{ sheet: phone }" data-panel="loading-card" data-scrollable
           aria-labelledby="loading-title">
    <div class="head">
      <div>
        <h2 id="loading-title" class="title">Loading this area</h2>
        <p class="meta">{{ area.analysed?.radius }} m around the point you clicked</p>
      </div>
      <button type="button" class="icon-btn" aria-label="Cancel loading" @click="cancel">
        <AppIcon name="close" />
      </button>
    </div>

    <ul class="steps">
      <li :class="{ active: area.load === 'loading' && !streetsDone, failed: area.load === 'error' && !streetsDone }">
        <AppIcon :name="streetsDone ? 'check' : 'pending'" />
        <span class="label">Streets</span>
        <span class="detail" role="status">{{ streetsDone ? `${area.counts.all} found` : '' }}</span>
        <!-- Finding the streets (OpenStreetMap) has no count: the bar slides until they are found. -->
        <span v-if="area.load === 'loading' && !streetsDone" class="bar waiting" aria-hidden="true"><span /></span>
      </li>
      <li :class="{ next: !streetsDone, active: photosActive, failed: area.load === 'error' && streetsDone }">
        <AppIcon :name="area.load === 'ready' ? 'check' : 'pending'" />
        <span class="label">Street photos</span>
        <span class="detail" role="status">{{ photosDetail }}</span>
        <span v-if="photosActive" class="bar" aria-hidden="true">
          <span :style="{ width: `${Math.round(share * 100)}%` }" />
        </span>
      </li>
      <!-- Only the steps the chosen layer needs: Senses skips thermal, Thermal skips the rating. -->
      <li v-if="area.needs.thermal" :class="{ next: area.thermal === 'idle', active: area.thermal === 'loading', failed: area.thermal === 'error' }">
        <AppIcon :name="area.thermal === 'ready' ? 'check' : 'pending'" />
        <span class="label">Thermal</span>
        <span class="detail" role="status">{{ area.thermalWindow.season }}, {{ area.thermalWindow.time }}</span>
        <!-- One simulation with no count: the bar slides until it is done. -->
        <span v-if="area.thermal === 'loading'" class="bar waiting" aria-hidden="true"><span /></span>
      </li>
      <!-- Senses rates every photo once they are found (board Flow 3). General, so not "for your profile" yet. -->
      <li v-if="area.layer === 'senses'" :class="{ next: !senses.areaRating, active: senses.areaRating }" data-testid="rating-step">
        <AppIcon name="pending" />
        <span class="label" role="status">{{ senses.areaRating ? `Rating ${rating.done} of ${rating.total} places…` : 'Rating the photos' }}</span>
        <span v-if="senses.areaRating" class="bar" aria-hidden="true">
          <span :style="{ width: `${rating.total ? Math.round((100 * rating.done) / rating.total) : 0}%` }" />
        </span>
      </li>
      <li v-if="area.layer === 'overall'" class="next">
        <AppIcon name="pending" /><span class="label">Rating for your profile</span>
      </li>
    </ul>

    <p v-if="area.load === 'error'" class="note error">{{ area.loadError }}</p>
    <p v-else-if="senses.areaRating" class="note">
      Streets light up as they are rated; you can keep exploring. <span data-testid="senses-cost">{{ moneyLine(senses.runs.area) }} so far.</span>
      <strong class="general">{{ GENERAL_LABEL }}</strong>
    </p>
    <p v-else-if="area.thermal === 'loading'" class="note">
      Simulating sun, shade and wind for this area. This can take a few minutes; click a street to see its photos meanwhile.
    </p>
    <p v-else-if="area.progress.stage === 'streets'" class="note">
      Finding the streets, parks and squares in this circle. This can take up to a minute; you can keep exploring.
    </p>
    <p v-else class="note">
      Streets appear in grey as they are found, and take their colour once they have a value. You can keep exploring.
    </p>

    <div class="buttons">
      <button v-if="area.load === 'error'" type="button" class="btn btn-primary" @click="area.retryLoad()">Try again</button>
      <button ref="cancelBtn" type="button" class="btn" @click="cancel">Cancel</button>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.card { padding: var(--space-5); overflow-y: auto; }
.general { display: block; margin-top: var(--space-2); font-weight: var(--fw-semibold); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.title { font-size: var(--fs-lg); font-weight: var(--fw-semibold); margin: 0; }
.meta { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.steps { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
.steps li {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-1) var(--space-3);
}
.steps .label { font-weight: var(--fw-medium); }
.steps .detail { font-size: var(--fs-sm); color: var(--text-2); }
.steps li.next { opacity: var(--inactive-opacity); }
.steps li.active :deep(.icon) { color: var(--mixed); }
.steps li.failed :deep(.icon) { color: var(--hard-text); }
.bar {
  grid-column: 2 / 4; height: var(--space-1); border-radius: var(--radius-pill);
  background: var(--line); overflow: hidden;
}
.bar span { display: block; height: 100%; background: var(--mixed); transition: width var(--transition); }
.bar.waiting span { width: 35%; animation: slide var(--bar-slide-s) ease-in-out infinite alternate; }
@keyframes slide {
  from { transform: translateX(0); }
  to { transform: translateX(186%); }
}
/* Reduced motion: a still, half-filled bar instead of a sliding one. */
@media (prefers-reduced-motion: reduce) {
  .bar.waiting span { width: 50%; transform: none; }
}
.note {
  margin: var(--space-4) 0 0; padding-top: var(--space-4); border-top: var(--hairline) solid var(--line);
  font-size: var(--fs-sm); color: var(--text-2);
}
.note.error { color: var(--text); }
.buttons { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }

/* Inside the phone sheet, which is the panel and does the scrolling. */
.card.sheet { padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.sheet .btn { min-height: var(--touch-phone); }
.sheet .icon-btn { width: var(--touch-phone); height: var(--touch-phone); }
</style>
