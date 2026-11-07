<script setup>
// Top hint for choosing an area or a walk on the map (boards Flow 1, 1b, 1c; Routes 1). Clicking is the
// default; "type an address" opens the inputs in the left panel (or the sheet) and focuses the first
// empty field. "Click" becomes "tap" on a phone. A walk that is too short or too long says so here.
import { computed, nextTick } from 'vue'
import { useAreaStore } from '../stores/area.js'
import { useRoutesStore } from '../stores/routes.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ phone: Boolean, routesMode: Boolean })
const area = useAreaStore()
const routes = useRoutesStore()
const verb = computed(() => (props.phone ? 'Tap' : 'Click'))

const hint = computed(() => {
  if (props.routesMode) {
    if (routes.step === 'start') {
      return { strong: `${verb.value} where you start,`, type: true, sub: routes.pointError }
    }
    if (routes.step === 'end') {
      return { strong: `Now ${verb.value.toLowerCase()} where you want to go,`, type: true, sub: routes.pointError }
    }
    if (routes.previewing) {
      return { strong: 'Walk set.', rest: ' Analyse it to find the two ways', sub: props.phone ? '' : 'Esc to start again' }
    }
    return null
  }
  switch (area.step) {
    case 'centre':
      return { strong: `${verb.value} to place the centre of your area,`, type: true, sub: 'Step 1 of 2: centre, then radius' }
    case 'radius':
      return props.phone
        ? { strong: 'Drag or tap to set the radius,', rest: ' lift to fix it', sub: 'Step 2 of 2' }
        : { strong: 'Move to set the radius,', rest: ' click to fix it', sub: 'Step 2 of 2. Esc to start again' }
    case 'set':
      return { strong: 'Area set.', rest: ' Drag the edge to adjust', sub: props.phone ? '' : 'Esc to start again' }
    default:
      return null
  }
})

/** The input fields, first empty one first: desktop panel or the phone sheet / top bar, whichever shows. */
function fieldIds() {
  if (!props.routesMode) return ['area-centre-input', 'area-centre-card-input']
  return routes.start ? ['route-end-input', 'route-end-phone-input'] : ['route-start-input', 'route-start-phone-input']
}
async function typeAddress() {
  if (props.routesMode) routes.inputsOpen = true
  else area.inputsOpen = true
  await nextTick()
  await nextTick() // the section opens, then its fields render
  const el = fieldIds().map((id) => document.getElementById(id)).find((e) => e && e.offsetParent !== null)
  el?.focus()
}
</script>

<template>
  <div v-if="hint" class="hint panel" data-panel="hint" role="status">
    <AppIcon name="crosshair" />
    <p>
      <strong>{{ hint.strong }}</strong>{{ hint.rest }}<template v-if="hint.type"> or
        <button type="button" class="type-link" @click="typeAddress">type an address</button></template>
    </p>
    <template v-if="hint.sub">
      <span class="divider" aria-hidden="true" />
      <p class="sub">{{ hint.sub }}</p>
    </template>
  </div>
</template>

<style scoped>
.hint {
  display: flex; align-items: center; flex-wrap: wrap; justify-content: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-5);
  min-height: var(--topbar-h);
}
p { margin: 0; }
strong { font-weight: var(--fw-semibold); }
.type-link {
  padding: 0; border: 0; background: transparent; color: var(--text);
  font: inherit; text-decoration: underline; text-underline-offset: var(--space-1);
}
/* The link is short text in a sentence: give it a full touch target without moving the text. */
@media (pointer: coarse) {
  .type-link { min-height: var(--touch-phone); }
}
.divider { width: var(--hairline); height: var(--space-5); background: var(--line); }
.sub { font-size: var(--fs-sm); color: var(--text-2); }
@media (max-width: 767px) {
  .hint { padding: var(--space-2) var(--space-4); }
  .divider { display: none; }
}
</style>
