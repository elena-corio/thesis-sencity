<script setup>
// One route as a state bar (brief §3 "all state bars share one style"). Every street of the route is its
// own section, as long as its walk, and the 2 px gap comes only where the state changes, so the bar still
// reads as blocks of colour. Hover or focus finds a street on the map; click selects it. The section's
// button is taller than the bar, so it is easier to hit. Keyboard: one Tab stop for the whole bar, and the
// arrow keys go along it (on the stretch card they step the selection instead).
import { computed, ref } from 'vue'
import { sectionLabel, stretchFeature } from '../lib/routes.js'
import { useRoutesStore } from '../stores/routes.js'

const props = defineProps({ route: { type: Object, required: true } })
const routes = useRoutesStore()
const bar = ref(null)
const total = computed(() => props.route.stretches.length)
const label = (s) => {
  const f = stretchFeature(s, routes.segments)
  return sectionLabel(s, total.value, f.properties.name, f.properties.utci)
}
/** The section Tab reaches: the selected or last-used street of this route, or the first. */
const tabKey = computed(() => {
  const own = (key) => props.route.stretches.some((s) => s.key === key)
  if (own(routes.selected?.key)) return routes.selected.key
  return own(routes.returnKey) ? routes.returnKey : props.route.stretches[0]?.key
})

function onKey(e) {
  if (routes.selected || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
  const items = [...bar.value.querySelectorAll('button')]
  const next = items[items.indexOf(document.activeElement) + (e.key === 'ArrowLeft' ? -1 : 1)]
  if (!next) return
  e.preventDefault()
  next.focus()
}
</script>

<template>
  <div ref="bar" class="bar" role="group" :aria-label="`Route ${route.id}, ${total} stretches`" @keydown="onKey">
    <button v-for="(s, i) in route.stretches" :key="s.key" type="button" class="section" :data-stretch="s.key"
            :class="{ selected: routes.selected?.key === s.key, hover: routes.hoverKey === s.key, change: i > 0 && route.stretches[i - 1].state !== s.state }"
            :style="{ flexGrow: s.length_m }" :aria-label="label(s)" :tabindex="s.key === tabKey ? 0 : -1"
            :aria-pressed="routes.selected?.key === s.key"
            @mouseenter="routes.hoverKey = s.key" @mouseleave="routes.hoverKey = null"
            @focus="routes.hoverKey = s.key" @blur="routes.hoverKey = null"
            @click="routes.selectStretch(s.key, undefined, $event.detail === 0)">
      <span :class="['fill', s.state]" />
    </button>
  </div>
</template>

<style scoped>
.bar { display: flex; min-width: 0; }
.section {
  flex: 1 1 0; min-width: var(--bar-min-section); height: var(--bar-hit-h);
  display: flex; align-items: center; padding: 0; border: 0; background: transparent;
}
.section.change { margin-left: var(--bar-gap); }
.fill {
  display: block; width: 100%; height: var(--bar-h); opacity: var(--bar-state-opacity);
  transition: opacity var(--transition);
}
.section:first-child .fill { border-radius: var(--bar-radius) 0 0 var(--bar-radius); }
.section:last-child .fill { border-radius: 0 var(--bar-radius) var(--bar-radius) 0; }
.section:only-child .fill { border-radius: var(--bar-radius); }
.fill.easy { background: var(--easy); }
.fill.mixed { background: var(--mixed); }
.fill.hard { background: var(--hard); opacity: 1; }
.fill.none { background: var(--no-photo); }
.section:hover .fill, .section.hover .fill { opacity: 1; box-shadow: inset 0 0 0 var(--hairline) var(--ring); }
.section.selected .fill { opacity: 1; box-shadow: inset 0 0 0 var(--focus-width) var(--ring); }
</style>
