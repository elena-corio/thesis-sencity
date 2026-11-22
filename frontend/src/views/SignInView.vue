<script setup>
// Sign in or create an account (board 0b; Elena, 2026-11-22): Clerk's own form, email code only (the methods are set
// in the Clerk dashboard: email, no password, no social logins). After it, the app opens on Area or Profile.
import { SignIn } from '@clerk/vue'
import { computed } from 'vue'
import AppLogo from '../components/AppLogo.vue'
import { useProfileStore } from '../stores/profile.js'

const profile = useProfileStore()
// A new account comes from "Create your profile" (the notice agreed): it goes on to the profile.
const after = computed(() => (profile.hasPendingConsent() ? '/profile' : '/area'))
</script>

<template>
  <main class="sign-in" data-panel="sign-in">
    <RouterLink to="/welcome" class="home" aria-label="SenCity, back to the welcome page"><AppLogo class="logo" /></RouterLink>
    <SignIn path="/sign-in" routing="path" :with-sign-up="true" :fallback-redirect-url="after" :sign-up-fallback-redirect-url="after" />
    <p class="foot">No password: you get a code by email. <RouterLink to="/welcome">Back</RouterLink></p>
  </main>
</template>

<style scoped>
.sign-in { min-height: 100dvh; background: var(--ground); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4); padding: var(--space-5) var(--margin); }
.home { color: var(--logo); }
.logo { width: calc(var(--logo-size) * 1.5); height: calc(var(--logo-size) * 1.5); }
.foot { margin: 0; color: var(--text-2); font-size: var(--fs-sm); }
.foot a { color: var(--text); }
</style>
