<script setup>
// "This area" (board Flow 1c): before analysis, with Analyse / Start again; once the area has
// loaded, the header, the number of streets with photos and Change area. A bottom sheet on a phone.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import config from '../config.js'
import { estimatePhotos, formatCoords } from '../lib/geo.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ phone: Boolean })
const emit = defineEmits(['focus-map'])
const area = useAreaStore()
const analyseBtn = ref(null)
const changeBtn = ref(null)

const place = computed(() => (area.step === 'analysed' ? area.analysed : { ...area.centre, radius: area.radius }))
const photos = computed(() => estimatePhotos(area.radius, config.photosPerKm2))
const heat = config.heatDefault

// Keyboard: after Enter fixes the radius, focus goes to Analyse; after Analyse, to Change area.
watch(() => area.step, async (step) => {
  if (!area.byKeyboard) return
  await nextTick()
  if (step === 'set') analyseBtn.value?.focus()
  if (step === 'analysed') changeBtn.value?.focus()
})
// Back from a loading or place card with the keyboard: focus Change area.
onMounted(() => { if (area.byKeyboard && area.step === 'analysed') changeBtn.value?.focus() })

function startAgain() {
  area.reset()
  emit('focus-map')
}
</script>

<template>
  <section v-if="area.step === 'set' || area.step === 'analysed'" class="card panel"
           :class="{ sheet: phone }" data-panel="area-card" data-scrollable aria-labelledby="area-title">
    <div v-if="phone" class="grip" aria-hidden="true" />
    <h2 id="area-title" class="title">This area</h2>
    <p class="meta">{{ formatCoords(place) }} · {{ place.radius }} m radius</p>

    <template v-if="area.step === 'set'">
      <p v-if="phone" class="meta">Drag the edge of the circle to adjust.</p>
      <ul class="facts">
        <li><AppIcon name="image" /> About {{ photos }} street photos</li>
        <li><AppIcon name="thermometer" /> Heat for {{ heat.season }}, {{ heat.time }}</li>
        <li><AppIcon name="clock" /> Ready in about a minute</li>
      </ul>
      <div class="buttons">
        <button ref="analyseBtn" type="button" class="btn btn-primary grow" @click="area.analyse($event.detail === 0)">
          Analyse this area
        </button>
        <button type="button" class="btn" @click="startAgain">Start again</button>
      </div>
    </template>

    <template v-else>
      <p v-if="area.load === 'ready'" class="summary">
        {{ area.counts.all }} street stretches · {{ area.counts.withPhotos }} with photos
      </p>
      <p class="hint">{{ props.phone ? 'Tap' : 'Click' }} a street to see its photos.</p>
      <div class="buttons">
        <button ref="changeBtn" type="button" class="btn" @click="startAgain">
          <AppIcon name="edit" /> Change area
        </button>
      </div>
    </template>

    <slot />
  </section>
</template>

<style scoped>
.card { padding: var(--space-5); overflow-y: auto; }
.title { font-size: var(--fs-lg); font-weight: var(--fw-semibold); margin: 0; }
.meta { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.summary { margin: var(--space-4) 0 0; }
.hint { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.facts { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.facts li { display: flex; align-items: center; gap: var(--space-3); color: var(--text); }
.facts :deep(.icon) { color: var(--text-2); }
.buttons { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
.buttons .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); }
.grow { flex: 1; }

.sheet {
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  border-bottom: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet .btn { min-height: var(--touch-phone); }
.grip {
  width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-3);
  border-radius: var(--radius-pill); background: var(--line);
}
</style>
