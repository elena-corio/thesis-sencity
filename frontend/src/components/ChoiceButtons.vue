<script setup>
// One choice out of a few, as separate bordered buttons: the only control of this kind in the app, in
// two weights. Thick for Layer; thin for Places, Radius and Season. A radiogroup: one Tab stop, and the
// arrow keys move and choose.
import { computed, nextTick, ref } from 'vue'

const props = defineProps({
  /** [{ id, label, disabled?, title? }] */
  options: { type: Array, required: true },
  value: { type: [String, Number], default: null },
  /** The group's name, or the id of the element that names it. */
  label: { type: String, default: undefined },
  labelledby: { type: String, default: undefined },
  weight: { type: String, default: 'thin' },
  disabled: Boolean,
})
const emit = defineEmits(['choose'])
const group = ref(null)

const off = (o) => props.disabled || o.disabled
const usable = computed(() => props.options.filter((o) => !off(o)))
const tabStop = computed(() => (usable.value.find((o) => o.id === props.value) ?? usable.value[0])?.id)

function onKey(e) {
  const list = usable.value
  if (!list.length) return
  const i = list.findIndex((o) => o.id === props.value)
  const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key]
  if (next == null) return
  e.preventDefault()
  emit('choose', list[(next + list.length) % list.length].id)
  nextTick(() => group.value?.querySelector('[aria-checked="true"]')?.focus())
}
</script>

<template>
  <div ref="group" class="choices" :class="weight" role="radiogroup" :aria-label="label" :aria-labelledby="labelledby"
       :aria-disabled="disabled" :style="{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }" @keydown="onKey">
    <button v-for="o in options" :key="o.id" type="button" role="radio" class="choice" :class="{ on: o.id === value }"
            :aria-checked="o.id === value" :tabindex="o.id === tabStop ? 0 : -1" :disabled="off(o)" :title="o.title"
            @click="emit('choose', o.id)">
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.choices { display: grid; }
.choice {
  min-width: 0; padding: 0 var(--space-1);
  border: var(--hairline) solid var(--line); background: transparent; color: var(--text);
}
.choice.on { border-color: var(--text-muted); background: var(--btn-selected-bg); font-weight: var(--fw-semibold); }
.choice:disabled { opacity: var(--inactive-opacity); }
.thick { gap: var(--space-2); }
.thick .choice { min-height: var(--touch); border-radius: var(--radius-btn); font-size: var(--fs-md); }
.thin { gap: var(--space-1); }
.thin .choice {
  min-height: var(--choice-thin-h); border-radius: var(--radius-chip);
  font-size: var(--fs-2xs); font-variant-numeric: tabular-nums;
}
/* Fingers need the full target, whatever the weight (brief §3). */
@media (pointer: coarse), (max-width: 767px) { .thick .choice, .thin .choice { min-height: var(--touch-phone); } }
</style>
