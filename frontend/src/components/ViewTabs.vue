<script setup>
// Area / Routes / Profile. Top centre on desktop, bottom tab bar on a phone (brief §3).
// Area and Routes work; Profile does not yet.
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
const route = useRoute()
const TABS = [
  { id: 'area', label: 'Area', icon: 'area', ready: true },
  { id: 'routes', label: 'Routes', icon: 'route', ready: true },
  { id: 'profile', label: 'Profile', icon: 'user', ready: false },
]
</script>

<template>
  <nav :class="phone ? 'tabbar' : 'tabs panel'" aria-label="Views" :data-panel="phone ? 'tabbar' : 'tabs'">
    <template v-for="t in TABS" :key="t.id">
      <RouterLink v-if="t.ready" :to="`/${t.id}`" class="tab" :class="{ on: route.params.mode === t.id }"
                  :aria-current="route.params.mode === t.id ? 'page' : undefined">
        <span v-if="phone" class="tab-icon"><AppIcon :name="t.icon" /></span>
        <span>{{ t.label }}</span>
      </RouterLink>
      <button v-else type="button" class="tab" aria-disabled="true" title="Coming soon">
        <span v-if="phone" class="tab-icon"><AppIcon :name="t.icon" /></span>
        <span>{{ t.label }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.tabs { display: flex; gap: var(--space-1); padding: var(--space-1); height: var(--topbar-h); }
.tabs .tab {
  display: grid; place-items: center;
  padding: 0 var(--space-4); border-radius: var(--radius-btn);
  border: var(--hairline) solid transparent; background: transparent;
  color: var(--text-2); font-size: var(--fs-md); font-weight: var(--fw-medium); text-decoration: none;
}
.tabs .tab.on { background: var(--btn-selected-bg); color: var(--text); border-color: var(--text-muted); }

.tabbar {
  display: grid; grid-template-columns: repeat(3, 1fr);
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--panel); border-top: var(--hairline) solid var(--line);
}
.tabbar .tab {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1);
  min-height: var(--touch-phone); border: 0; background: transparent;
  color: var(--text-muted); font-size: var(--fs-xs); text-decoration: none;
}
.tabbar .tab.on { color: var(--text); font-weight: var(--fw-semibold); }
.tab-icon { display: grid; place-items: center; padding: var(--space-1) var(--space-4); border-radius: var(--radius-pill); }
.tabbar .tab.on .tab-icon { background: var(--btn-selected-bg); }
</style>
