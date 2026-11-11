<script setup>
// The comfort key (boards Flow 4, Routes 3, Routes 5; Elena 2026-11-11): "<Layer> · <season>, <time>" (Senses alone),
// then Easy / Mixed / Hard / No photo on one line. In the right card under the bar(s), with a thin line above (`rule`);
// on a phone it floats on the map, above the sheet. Never in the left panel, and not on a detail card, which has its own
// label and bars.
import { computed } from 'vue'
import { keyRows, keyTitle } from '../lib/legend.js'

const props = defineProps({
  layer: { type: String, required: true },
  /** { season, time } of what is shown, or null. */
  window: { type: Object, default: null },
  rule: Boolean,
})
const title = computed(() => keyTitle(props.layer, props.window))
const rows = computed(() => keyRows(props.layer))
</script>

<template>
  <div class="key" :class="{ rule }" data-testid="comfort-key">
    <p class="title"><strong>{{ title.name }}</strong><template v-if="title.when"> · {{ title.when }}</template></p>
    <ul class="rows" data-testid="legend-rows">
      <li v-for="r in rows" :key="r.id"><span class="swatch" :style="{ background: r.color }" />{{ r.label }}</li>
    </ul>
  </div>
</template>

<style scoped>
.key.rule { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.title { margin: 0; font-size: var(--fs-sm); color: var(--text-2); }
.title strong { color: var(--text); font-weight: var(--fw-semibold); }
.rows { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: var(--space-2) 0 0; padding: 0; font-size: var(--fs-sm); }
.rows li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { flex: none; width: var(--space-4); height: var(--swatch-h); border-radius: var(--radius-pill); }
</style>
