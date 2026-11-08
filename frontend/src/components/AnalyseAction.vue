<script setup>
// The primary Analyse button and its one muted line, under the area or walk inputs (board Flow 1c).
// Disabled until everything is set. Set with the keyboard, the focus comes here.
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  note: { type: String, required: true },
  ready: Boolean,
  byKeyboard: Boolean,
})
const emit = defineEmits(['analyse'])
const btn = ref(null)

function follow() {
  if (props.ready && props.byKeyboard) nextTick(() => btn.value?.focus())
}
watch(() => props.ready, follow)
onMounted(follow)
</script>

<template>
  <div class="analyse">
    <button ref="btn" type="button" class="btn btn-primary" :disabled="!ready" @click="emit('analyse', $event.detail === 0)">
      {{ label }}
    </button>
    <p class="note">{{ note }}</p>
  </div>
</template>

<style scoped>
.analyse { margin-top: var(--space-3); }
.btn { width: 100%; min-height: var(--touch-phone); }
.btn:disabled { opacity: var(--inactive-opacity); }
.note { margin: var(--space-3) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
</style>
