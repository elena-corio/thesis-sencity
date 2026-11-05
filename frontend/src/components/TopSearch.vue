<script setup>
// Logo + search. Suggestions appear while typing (through the API, Photon); picking one moves
// the map there. On a phone the account button sits in the same bar (board P1).
import { computed, ref } from 'vue'
import AccountMenu from './AccountMenu.vue'
import AppLogo from './AppLogo.vue'
import PlaceSearch from './PlaceSearch.vue'

const props = defineProps({
  phone: Boolean,
  /** Returns the map centre, used to rank nearby places first. */
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick'])

const menuOpen = ref(false)
const accountBtn = ref(null)
function closeMenu() {
  menuOpen.value = false
  accountBtn.value?.focus()
}

const fieldId = computed(() => (props.phone ? 'search-results-phone-input' : 'search-results-input'))
</script>

<template>
  <div class="bar panel" data-panel="search">
    <AppLogo />
    <span class="divider" aria-hidden="true" />
    <PlaceSearch :field-id="fieldId" label="Search a street or place" placeholder="Search a street or place"
                 with-icon :get-centre="getCentre" @pick="emit('pick', $event)" />
    <div v-if="phone" class="account">
      <button ref="accountBtn" type="button" class="avatar" data-menu-button
              :aria-expanded="menuOpen" aria-haspopup="dialog" aria-label="Your account"
              @click="menuOpen = !menuOpen">EC</button>
      <AccountMenu v-if="menuOpen" @close="closeMenu" />
    </div>

  </div>
</template>

<style scoped>
.bar {
  position: relative;
  display: flex; align-items: center; gap: var(--space-3);
  height: var(--topbar-h);
  padding: 0 var(--space-2) 0 var(--space-3);
}
.divider { width: var(--hairline); align-self: stretch; margin: var(--space-3) 0; background: var(--line); }
.account { position: relative; }
.avatar {
  width: var(--touch-phone); height: var(--touch-phone);
  border-radius: 50%; border: var(--hairline) solid var(--line);
  background: var(--btn-selected-bg); font-weight: var(--fw-semibold);
}
</style>
