<script setup>
// One 1–5 answer (boards 4, P4): a group of five radio buttons, so the arrow keys move between them and a screen
// reader names the row. The label and its icon come from part_a.json and elements.json (icon_key).
import SenseIcon from './SenseIcon.vue'

const props = defineProps({
  name: { type: String, required: true },
  label: { type: String, required: true },
  modelValue: { type: Number, default: null },
  sense: { type: String, default: null },
  senseName: { type: String, default: '' },
  /** The words of each value, for screen readers ("1, very unpleasant"). */
  words: { type: Array, default: () => [] },
  /** A question on its own (A11): the label is the question above, so it is not repeated here. */
  bare: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const VALUES = [1, 2, 3, 4, 5]
</script>

<template>
  <fieldset class="score" :class="{ bare }" :data-row="name">
    <legend :class="{ 'visually-hidden': bare }">
      <SenseIcon v-if="sense" :sense="sense" :label="senseName" />
      <span>{{ label }}</span>
    </legend>
    <div class="boxes">
      <label v-for="v in VALUES" :key="v" class="box" :class="{ on: props.modelValue === v }">
        <input type="radio" class="visually-hidden" :name="name" :value="v" :checked="props.modelValue === v"
               :aria-label="words[v - 1] ? `${v}, ${words[v - 1]}` : String(v)" @change="emit('update:modelValue', v)">
        <span aria-hidden="true">{{ props.modelValue === v ? v : '' }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.score {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--space-3);
  margin: 0; padding: var(--space-2) 0; border: 0; border-top: var(--hairline) solid var(--line); min-width: 0;
}
.score.bare { border-top: 0; grid-template-columns: 1fr; }
legend {
  float: left; display: flex; align-items: center; gap: var(--space-3); padding: 0;
  color: var(--text); font-size: var(--fs-md);
}
legend :deep(.sense-icon) { color: var(--text-muted); }
.boxes { display: grid; grid-template-columns: repeat(5, var(--score-w)); gap: var(--space-2); }
.bare .boxes { grid-template-columns: repeat(5, minmax(var(--score-w), 1fr)); }
.box {
  display: grid; place-items: center; height: var(--score-h);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  font-weight: var(--fw-semibold); cursor: pointer;
}
.box.on { background: var(--btn-primary-bg); border-color: var(--btn-primary-bg); color: var(--btn-primary-text); }
.box:has(input:focus-visible) { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }

@container onboarding (max-width: 560px) {
  .score { grid-template-columns: 1fr; }
  .boxes { grid-template-columns: repeat(5, 1fr); }
  .box { height: var(--score-h-phone); }
}
</style>
