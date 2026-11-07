<script setup>
// One search field with suggestions while typing (through the API, Photon): the top bar and the Start
// and End fields of Routes. The list floats under the nearest positioned parent.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import config from '../config.js'
import { kindLabel, searchPlaces } from '../lib/api.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  fieldId: { type: String, required: true },
  label: { type: String, required: true },
  placeholder: { type: String, required: true },
  /** The text shown from outside (a clicked point, a chosen place). */
  value: { type: String, default: '' },
  /** Ends the sentence "Try another spelling, or …" and "You can still …". */
  fallback: { type: String, default: 'choose an area on the map' },
  withIcon: Boolean,
  /** Returns the map centre, used to rank nearby places first. */
  getCentre: { type: Function, default: () => null },
})
const emit = defineEmits(['pick', 'clear', 'open', 'focus', 'blur'])

const query = ref(props.value)
const results = ref([])
const status = ref('idle') // idle | loading | done | error
const errorText = ref('')
const open = ref(false)
const active = ref(-1)
const input = ref(null)
let timer
let controller
let quiet = false // the next query change does not come from typing

const trimmed = computed(() => query.value.trim())
const listId = computed(() => props.fieldId.replace(/-input$/, ''))
const showDropdown = computed(() => open.value && trimmed.value.length >= config.search.minChars)
const activeId = computed(() => (active.value >= 0 ? `${listId.value}-${active.value}` : undefined))
watch(showDropdown, (v) => emit('open', v))

watch(() => props.value, (v) => {
  if (v === query.value) return
  quiet = true
  query.value = v
  open.value = false
})

watch(query, (now, was) => {
  clearTimeout(timer)
  controller?.abort()
  active.value = -1
  if (quiet) {
    quiet = false
    return
  }
  if (!now && was) emit('clear')
  if (trimmed.value.length < config.search.minChars) {
    results.value = []
    status.value = 'idle'
    return
  }
  open.value = true
  status.value = 'loading'
  timer = setTimeout(run, config.search.debounceMs)
})

async function run() {
  controller = new AbortController()
  const q = trimmed.value
  try {
    const found = await searchPlaces(q, props.getCentre(), controller.signal)
    if (q !== trimmed.value) return // a newer search is on its way
    results.value = found
    status.value = 'done'
  } catch (e) {
    if (e.name === 'AbortError') return
    results.value = []
    status.value = 'error'
    errorText.value = e.status === 429
      ? 'Too many searches. Wait a moment and try again.'
      : `Search is not available right now. You can still ${props.fallback}.`
  }
}

function pick(i) {
  const r = results.value[i]
  if (!r) return
  // Only a real change of the text triggers the watcher: picking "Linz" after typing "Linz" must not
  // leave `quiet` set, or the next typing would be ignored.
  if (query.value !== r.name) {
    quiet = true
    query.value = r.name
  }
  open.value = false
  clearTimeout(timer)
  controller?.abort()
  status.value = 'done'
  emit('pick', r)
}

function onKeydown(e) {
  const n = results.value.length
  if (e.key === 'ArrowDown' && n) {
    open.value = true
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    open.value = true
    active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    if (showDropdown.value && n) pick(active.value >= 0 ? active.value : 0)
  } else if (e.key === 'Escape') {
    // Handled here, so Esc in a search field never resets the area or the route.
    if (showDropdown.value) open.value = false
    else query.value = ''
  } else {
    return
  }
  e.preventDefault()
  e.stopPropagation()
}

function clear() {
  query.value = ''
  input.value?.focus()
}

onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})
</script>

<template>
  <div class="search">
    <AppIcon v-if="withIcon" name="search" />
    <label :for="fieldId" class="visually-hidden">{{ label }}</label>
    <input :id="fieldId" ref="input" v-model="query" type="search" :placeholder="placeholder"
           autocomplete="off" spellcheck="false" :maxlength="100"
           role="combobox" aria-autocomplete="list" :aria-expanded="showDropdown"
           :aria-controls="listId" :aria-activedescendant="showDropdown ? activeId : undefined"
           @keydown="onKeydown" @focus="open = true; emit('focus')" @blur="open = false; emit('blur')" />
    <button v-if="query" type="button" class="clear" :aria-label="`Clear: ${label}`" @mousedown.prevent @click="clear">
      <AppIcon name="close" />
    </button>
  </div>

  <div v-show="showDropdown" class="dropdown panel" data-popover>
    <ul :id="listId" role="listbox" aria-label="Places found">
      <li v-for="(r, i) in results" :id="`${listId}-${i}`" :key="`${r.lat},${r.lon},${i}`"
          role="option" :aria-selected="i === active" :class="{ active: i === active }"
          @mousedown.prevent @click="pick(i)" @mousemove="active = i">
        <span class="name">{{ r.name }}</span>
        <span class="detail">{{ [kindLabel(r.kind), r.detail].filter(Boolean).join(' · ') }}</span>
      </li>
    </ul>
    <p class="status" role="status">
      <template v-if="status === 'loading'">Searching…</template>
      <template v-else-if="status === 'error'">{{ errorText }}</template>
      <template v-else-if="status === 'done' && !results.length">
        No places found for “{{ trimmed }}”. Try another spelling, or {{ fallback }}.
      </template>
    </p>
  </div>
</template>

<style scoped>
.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); }
input {
  flex: 1; min-width: 0; border: 0; background: transparent;
  font-size: var(--fs-md); color: var(--text);
  text-overflow: ellipsis;
}
input::placeholder { color: var(--text-muted); }
input::-webkit-search-cancel-button { display: none; }
.clear {
  width: var(--touch); height: var(--touch); flex: none;
  display: grid; place-items: center;
  border: 0; border-radius: var(--radius-btn); background: transparent; color: var(--text-2);
}

/* Results scroll inside their own panel (brief §3). */
.dropdown {
  position: absolute; top: calc(100% + var(--space-2)); left: 0; right: 0; z-index: 20;
  max-height: calc(100dvh - var(--topbar-h) - 3 * var(--margin));
  overflow-y: auto;
  padding: var(--space-1);
}
ul { list-style: none; margin: 0; padding: 0; }
li {
  display: flex; flex-direction: column;
  min-height: var(--touch-phone); justify-content: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-btn);
  cursor: pointer;
}
li.active { background: var(--btn-selected-bg); }
.name { font-weight: var(--fw-medium); overflow-wrap: anywhere; }
.detail { font-size: var(--fs-sm); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { margin: 0; padding: 0 var(--space-3); font-size: var(--fs-sm); color: var(--text-2); }
.status:not(:empty) { padding: var(--space-2) var(--space-3); }
</style>
