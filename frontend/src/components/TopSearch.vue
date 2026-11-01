<script setup>
// Logo + search (inactive for now). On a phone the account button sits in the same bar (board P1).
import { ref } from 'vue'
import AccountMenu from './AccountMenu.vue'
import AppIcon from './AppIcon.vue'
import AppLogo from './AppLogo.vue'

defineProps({ phone: Boolean })
const menuOpen = ref(false)
const accountBtn = ref(null)
function closeMenu() {
  menuOpen.value = false
  accountBtn.value?.focus()
}
</script>

<template>
  <div class="bar panel" data-panel="search">
    <AppLogo />
    <span class="divider" aria-hidden="true" />
    <label class="search">
      <AppIcon name="search" />
      <span class="visually-hidden">Search a street or place (coming soon)</span>
      <input type="search" placeholder="Search a street or place" readonly aria-disabled="true" />
    </label>
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
  display: flex; align-items: center; gap: var(--space-3);
  height: var(--topbar-h);
  padding: 0 var(--space-2) 0 var(--space-3);
}
.divider { width: var(--hairline); align-self: stretch; margin: var(--space-3) 0; background: var(--line); }
.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); }
input {
  flex: 1; min-width: 0; border: 0; background: transparent;
  font-size: var(--fs-md); color: var(--text);
  text-overflow: ellipsis;
}
input::placeholder { color: var(--text-muted); }
.account { position: relative; }
.avatar {
  width: var(--touch-phone); height: var(--touch-phone);
  border-radius: 50%; border: var(--hairline) solid var(--line);
  background: var(--btn-selected-bg); font-weight: var(--fw-semibold);
}
</style>
