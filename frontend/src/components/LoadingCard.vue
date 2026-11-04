<script setup>
// "Loading this area" (boards Flow 2, Flow 3): street photos, then thermal comfort (Infrared.city),
// then rating (shown greyed: it does not exist yet). Streets light up on the map as their photos are
// found, then in their thermal colour.
import { computed, onMounted, ref } from 'vue'
import config from '../config.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
const area = useAreaStore()
const thermal = config.thermalDefault
const cancelBtn = ref(null)
// Started with the keyboard: focus Cancel, so Enter or Space can stop it.
onMounted(() => { if (area.byKeyboard) cancelBtn.value?.focus() })

const photosDetail = computed(() => {
  const p = area.progress
  if (area.load === 'error') return ''
  if (area.load === 'ready') return `${area.counts.all} of ${area.counts.all}`
  return p.stage === 'streets' ? 'finding the streets…' : `${p.done} of ${p.total}`
})
const share = computed(() => (area.progress.total ? area.progress.done / area.progress.total : 0))
</script>

<template>
  <section class="card panel" :class="{ sheet: phone }" data-panel="loading-card" data-scrollable
           aria-labelledby="loading-title">
    <div v-if="phone" class="grip" aria-hidden="true" />
    <div class="head">
      <div>
        <h2 id="loading-title" class="title">Loading this area</h2>
        <p class="meta">{{ area.analysed?.radius }} m around the point you clicked</p>
      </div>
      <button type="button" class="icon-btn" aria-label="Cancel loading" @click="area.cancelLoad()">
        <AppIcon name="close" />
      </button>
    </div>

    <ul class="steps">
      <li :class="{ active: area.load === 'loading', failed: area.load === 'error' }">
        <AppIcon :name="area.load === 'ready' ? 'check' : 'pending'" />
        <span class="label">Street photos</span>
        <span class="detail" role="status">{{ photosDetail }}</span>
        <!-- Finding the streets (OpenStreetMap) has no count: the bar slides until the photos start. -->
        <span v-if="area.load === 'loading'" class="bar" :class="{ waiting: area.progress.stage === 'streets' }" aria-hidden="true">
          <span :style="area.progress.stage === 'streets' ? {} : { width: `${Math.round(share * 100)}%` }" />
        </span>
      </li>
      <li :class="{ next: area.thermal === 'idle', active: area.thermal === 'loading', failed: area.thermal === 'error' }">
        <AppIcon :name="area.thermal === 'ready' ? 'check' : 'pending'" />
        <span class="label">Thermal</span>
        <span class="detail" role="status">{{ thermal.season }}, {{ thermal.time }}</span>
        <!-- One simulation with no count: the bar slides until it is done. -->
        <span v-if="area.thermal === 'loading'" class="bar waiting" aria-hidden="true"><span /></span>
      </li>
      <li class="next">
        <AppIcon name="pending" /><span class="label">Rating for your profile</span>
      </li>
    </ul>

    <p v-if="area.load === 'error'" class="note error">{{ area.loadError }}</p>
    <p v-else-if="area.thermal === 'loading'" class="note">
      Simulating sun, shade and wind for this area. This can take a few minutes; click a street to see its photos meanwhile.
    </p>
    <p v-else-if="area.progress.stage === 'streets'" class="note">
      Finding the streets, parks and squares in this circle. This can take up to a minute; you can keep exploring.
    </p>
    <p v-else class="note">
      Streets light up as their photos are found. You can keep exploring.
    </p>

    <div class="buttons">
      <button v-if="area.load === 'error'" type="button" class="btn btn-primary" @click="area.startLoad()">Try again</button>
      <button ref="cancelBtn" type="button" class="btn" @click="area.cancelLoad()">Cancel</button>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.card { padding: var(--space-5); overflow-y: auto; }
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

.sheet {
  border-radius: var(--radius-panel) var(--radius-panel) 0 0; border-bottom: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet .btn { min-height: var(--touch-phone); }
.grip {
  width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-3);
  border-radius: var(--radius-pill); background: var(--line);
}
</style>
