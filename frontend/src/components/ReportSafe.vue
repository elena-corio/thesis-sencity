<script setup>
// One section of the printable report, guarded (Elena, 2026-11-23: after clicking some places Print did nothing). If the
// section fails to draw, it says so in its place and the rest of the report still opens; before, one failing part
// left the report half-open, and every later click on Print did nothing until the page was reloaded. The error goes
// to the browser console, with the section's name, to find the cause.
import { onErrorCaptured, ref } from 'vue'

const props = defineProps({ name: { type: String, required: true } })
const failed = ref(false)
onErrorCaptured((err) => {
  failed.value = true
  console.error(`Report: the ${props.name} section could not be drawn.`, err)
  return false
})
</script>

<template>
  <section v-if="failed" class="failed" :data-section="`failed-${name}`" role="status">
    <p>This part of the report ({{ name }}) could not be drawn. The rest of the report is complete.</p>
  </section>
  <slot v-else />
</template>

<style scoped>
.failed {
  padding: var(--space-3) var(--space-5); border-radius: var(--radius-btn);
  border: var(--hairline) dashed var(--report-muted); background: var(--report-soft); color: var(--report-muted);
}
</style>
