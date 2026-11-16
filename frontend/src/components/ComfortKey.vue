<script setup>
// The comfort key (boards Flow 4, Routes 3, Routes 5; Elena 2026-11-11): "<Layer> · <season>, <time>" (Senses alone),
// then Easy / Mixed / Hard / No photo on one line. In the right card under the bar(s), with a thin line above (`rule`);
// on a phone it floats on the map, above the sheet. Never in the left panel, and not on a detail card, which has its own
// label and bars.
import { computed } from 'vue'
import { keyRows, keyTitle } from '../lib/legend.js'
import HowLink from './HowLink.vue'

const props = defineProps({
  layer: { type: String, required: true },
  /** { season, time } of what is shown, or null. */
  window: { type: Object, default: null },
  rule: Boolean,
  /** The walk (board Routes 5, photos and play): one line, the layer in one word, the window under it on Thermal. */
  inline: Boolean,
})
const title = computed(() => keyTitle(props.layer, props.window))
const rows = computed(() => keyRows(props.layer))
/** The inline key names the layer in one word (the walk, Elena 2026-11-14). */
const SHORT = { senses: 'Senses', thermal: 'Thermal' }
</script>

<template>
  <div class="key" :class="{ rule, inline }" data-testid="comfort-key">
    <p v-if="!inline" class="title"><strong>{{ title.name }}</strong><template v-if="title.when"> · {{ title.when }}</template></p>
    <p v-else class="title inline-title">
      <strong>{{ SHORT[layer] ?? title.name }}</strong>
      <span v-if="title.when" class="when">{{ title.when }}</span>
    </p>
    <ul class="rows" data-testid="legend-rows">
      <li v-for="r in rows" :key="r.id"><span class="swatch" :style="{ background: r.color }" />{{ r.label }}</li>
    </ul>
    <HowLink v-if="!inline" section="colours" />
  </div>
</template>

<style scoped>
.key.rule { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.title { margin: 0; font-size: var(--fs-sm); color: var(--text-2); }
.title strong { color: var(--text); font-weight: var(--fw-semibold); }
.rows { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: var(--space-2) 0 0; padding: 0; font-size: var(--fs-sm); }
.rows li { display: flex; align-items: center; gap: var(--space-2); }
.key.inline { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-1) var(--space-3); }
.inline .rows { margin: 0; }
.inline-title { display: flex; flex-direction: column; line-height: 1.25; }
.inline-title .when { font-size: var(--fs-2xs); }
.key.inline, .inline .rows { font-size: var(--fs-xs); }
.inline .rows { gap: var(--space-1) var(--space-2); }
.inline .rows li { gap: var(--space-1); }
.swatch { flex: none; width: var(--space-4); height: var(--swatch-h); border-radius: var(--radius-pill); }
</style>
