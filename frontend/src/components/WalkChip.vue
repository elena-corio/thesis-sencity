<script setup>
// "Walking route B · easiest, summer 15:00" (boards Routes 5, P6): which way is walked, for which window. On a phone the
// Layer button sits next to it and opens the Settings of the sheet.
import { computed } from 'vue'
import { chipText } from '../lib/walk.js'
import { useRoutesStore } from '../stores/routes.js'
import { useWalkStore } from '../stores/walk.js'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
defineEmits(['layers'])
const walk = useWalkStore()
const routes = useRoutesStore()
const text = computed(() => chipText(walk.route, routes.info))
</script>

<template>
  <div class="chip-row" :class="{ phone }">
    <div class="chip panel" role="status" data-panel="walk-chip">
      <span :class="['sample', walk.route.id]" aria-hidden="true" />
      <strong>{{ text.title }}</strong>
      <span class="detail">{{ text.detail }}</span>
    </div>
    <button v-if="phone" type="button" class="layers-btn panel" aria-label="Layer, season and time" @click="$emit('layers')">
      <AppIcon name="layers" />
    </button>
  </div>
</template>

<style scoped>
.chip-row { display: flex; align-items: center; gap: var(--space-2); }
.chip {
  display: flex; align-items: center; gap: var(--space-3); min-width: 0;
  padding: calc(var(--space-2) + 2px) var(--space-4); border-radius: var(--radius-btn);
  white-space: nowrap;
}
.chip strong { font-weight: var(--fw-semibold); }
.detail { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; }
.sample { display: inline-block; flex: none; width: var(--route-sample-w); height: var(--space-1); border-radius: var(--radius-pill); }
.sample.A { background: var(--text); }
.sample.B { background: linear-gradient(to right, var(--text) 30%, transparent 30%, transparent 47%, var(--text) 47%, var(--text) 77%, transparent 77%); }

/* Phone (board P6): the chip fills the row, the Layer button beside it. */
.phone .chip { flex: 1; height: var(--walk-chip-h); padding: 0 var(--space-3); gap: var(--space-2); font-size: var(--fs-sm); }
.layers-btn {
  flex: none; display: grid; place-items: center; width: var(--touch-phone); height: var(--walk-chip-h);
  padding: 0; border-radius: var(--radius-btn); color: var(--text);
}
</style>
