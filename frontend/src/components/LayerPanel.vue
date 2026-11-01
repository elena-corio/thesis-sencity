<script setup>
// Left panel: layer, legend, places (board Flow 1). Inactive until an area is loaded:
// the panel stays visible, only the controls fade (brief §3 Map flow).
import { useAreaStore } from '../stores/area.js'

const area = useAreaStore()
const LAYERS = ['Senses', 'Heat', 'Overall']
const LEGEND = [
  { label: 'Easy', color: 'var(--easy)' },
  { label: 'Mixed', color: 'var(--mixed)' },
  { label: 'Hard', color: 'var(--hard)' },
  { label: 'No photo', color: 'var(--no-photo)' },
]
const PLACES = ['All', 'Parks', 'Squares', 'Markets', 'Busy roads', 'Residential']
</script>

<template>
  <aside class="panel left" data-panel="layers" data-scrollable aria-label="Layers and places">
    <section>
      <h2 class="section-title">Layer</h2>
      <div class="layers inactive">
        <button v-for="l in LAYERS" :key="l" type="button" class="seg" disabled>{{ l }}</button>
      </div>
      <ul class="legend inactive">
        <li v-for="s in LEGEND" :key="s.label"><span class="swatch" :style="{ background: s.color }" />{{ s.label }}</li>
      </ul>
      <p class="note">
        {{ area.step === 'analysed' ? 'Layers are ready once this area has loaded.' : 'Layers appear once you load an area.' }}
      </p>
    </section>
    <section class="places">
      <h2 class="section-title">Places</h2>
      <div class="chips inactive">
        <button v-for="p in PLACES" :key="p" type="button" class="chip" :class="{ on: p === 'All' }" disabled>{{ p }}</button>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.left { padding: var(--space-4) var(--space-5); overflow-y: auto; }
section + section { border-top: var(--hairline) solid var(--line); margin-top: var(--space-4); padding-top: var(--space-4); }
.layers { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-3); }
.seg {
  min-height: var(--touch); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; font-size: var(--fs-md);
}
.legend {
  list-style: none; padding: 0; margin: var(--space-4) 0 0;
  display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4);
}
.legend li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); }
.note { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.chip {
  min-height: var(--chip-h); padding: 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill);
  background: transparent; font-size: var(--fs-sm);
}
.chip.on { background: var(--btn-selected-bg); }
</style>
