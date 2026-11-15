<script setup>
// No profile yet (board 5b): what it is, Create your profile, and that the map is general until then. Also: import a
// file saved earlier, and, in dev mode only, the made-up test profile.
import AppLogo from './AppLogo.vue'

defineProps({ error: { type: String, default: '' }, dev: Boolean })
const emit = defineEmits(['create', 'import', 'test'])
</script>

<template>
  <section class="empty" aria-labelledby="empty-title" data-panel="profile-empty">
    <AppLogo class="logo" />
    <h2 id="empty-title" tabindex="-1">You don't have a profile yet</h2>
    <p class="text">Answer a few questions about what feels pleasant or unpleasant to your senses in public spaces. It takes
      about 5 minutes, and you can change your answers later.</p>
    <button type="button" class="btn btn-primary create" @click="emit('create')">Create your profile</button>
    <p class="muted">Until then, the map shows general ratings, not personalised for you.</p>
    <div class="more">
      <button type="button" class="link" @click="emit('import')">Import a profile file</button>
      <button v-if="dev" type="button" class="link" data-dev @click="emit('test')">Load the test profile (dev only)</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
p, h2 { margin: 0; }
.empty {
  max-width: var(--onboarding-w); min-height: 100%; justify-content: center; margin: 0 auto; padding: var(--space-5) var(--space-4);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3); text-align: center;
}
.logo { width: var(--empty-logo); height: var(--empty-logo); opacity: 0.6; }
h2 { font-size: var(--fs-xl); font-weight: var(--fw-semibold); line-height: 1.2; }
.text { color: var(--text-2); font-size: var(--fs-md); }
.create { margin-top: var(--space-2); min-height: var(--touch-phone); }
.muted { font-size: var(--fs-sm); color: var(--text-muted); }
.more { display: flex; gap: var(--space-4); flex-wrap: wrap; justify-content: center; }
.link { border: 0; background: none; padding: var(--space-2); min-height: var(--touch); color: var(--text-2); text-decoration: underline; }
.error { color: var(--hard-text); font-size: var(--fs-sm); }
</style>
