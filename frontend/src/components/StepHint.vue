<script setup>
// Top hint for the two-click selection (boards Flow 1, 1b, 1c). "Click" becomes "tap" on a phone.
import { computed } from 'vue'
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
      return { strong: `${verb.value} where you start`, rest: '', sub: props.phone ? '' : 'or type it on the left' }
    }
    if (routes.step === 'end') {
      return { strong: `Start set. Now ${verb.value.toLowerCase()} where you want to go`, rest: '', sub: props.phone ? '' : 'or type it on the left' }
    }
    if (routes.previewing) {
      return { strong: 'Walk set.', rest: ' Analyse it to find the two ways', sub: props.phone ? '' : 'Esc to start again' }
    }
    return null
  }
  switch (area.step) {
    case 'centre':
      return { strong: `${verb.value} to place the centre`, rest: ' of your area', sub: 'Step 1 of 2: centre, then radius' }
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
</script>

<template>
  <div v-if="hint" class="hint panel" data-panel="hint" role="status">
    <AppIcon name="crosshair" />
    <p><strong>{{ hint.strong }}</strong>{{ hint.rest }}</p>
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
.divider { width: var(--hairline); height: var(--space-5); background: var(--line); }
.sub { font-size: var(--fs-sm); color: var(--text-2); }
@media (max-width: 767px) {
  .hint { padding: var(--space-2) var(--space-4); }
  .divider { display: none; }
}
</style>
