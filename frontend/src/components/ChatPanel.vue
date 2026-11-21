<script setup>
// "Ask about places" (board 2; Elena, 2026-11-21): the chat panel, on the right like the place card, full screen on a
// phone. A typed message goes to POST /api/chat (its text only) and comes back as an intent the app carries out; the
// ready-made prompts and a removed pill need no model call. Replies are the app's own templates, shown as plain text.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PRESETS } from '../lib/chat/intent.js'
import { EXAMPLES, INTRO, PLACEHOLDERS } from '../lib/chat/templates.js'
import { useChatStore } from '../stores/chat.js'
import AppIcon from './AppIcon.vue'

defineProps({ phone: Boolean })
const chat = useChatStore()
const text = ref('')
const input = ref(null)
const list = ref(null)
const help = ref(false)

// The rotating example in the input (every 4 s; still with reduced motion).
const tick = ref(0)
let timer = null
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
onMounted(() => {
  if (!reduced) timer = setInterval(() => { tick.value++ }, 4000)
  input.value?.focus()
})
onBeforeUnmount(() => clearInterval(timer))
const placeholder = computed(() => `e.g. ${PLACEHOLDERS[tick.value % PLACEHOLDERS.length]}`)
const lastApp = computed(() => [...chat.messages].reverse().find((m) => m.role === 'app') ?? null)

async function submit() {
  if (await chat.send(text.value)) text.value = ''
}
function ask(example) {
  help.value = false
  text.value = example
  submit()
}
watch(() => chat.messages.length, () => nextTick(() => { if (list.value) list.value.scrollTop = list.value.scrollHeight }))
</script>

<template>
  <section class="chat panel" :class="{ phone }" data-panel="chat" aria-labelledby="chat-title">
    <header class="head">
      <h2 id="chat-title">Ask about places</h2>
      <button type="button" class="icon-btn" aria-label="Close the chat" @click="chat.close()"><AppIcon name="close" /></button>
    </header>

    <div ref="list" class="messages" data-scrollable aria-live="polite">
      <p v-if="!chat.messages.length" class="intro" data-testid="chat-intro">{{ INTRO }}</p>
      <template v-for="(m, i) in chat.messages" :key="i">
        <p v-if="m.role === 'you'" class="you">{{ m.text }}</p>
        <div v-else class="app" data-testid="chat-reply">
          <p>{{ m.text }}</p>
          <blockquote v-if="m.quote" class="quote"><span class="muted">{{ m.quote.label }}</span> {{ m.quote.text }}</blockquote>
          <ol v-if="m.items?.length" class="items">
            <li v-for="it in m.items" :key="it.id">
              <button type="button" class="item" :data-place="it.id" @click="chat.openPlace(it.id)">
                <span class="n" :class="it.level">{{ it.n }}</span>
                <span class="name">{{ it.name }}</span>
                <span class="muted">{{ it.level ?? 'not rated' }}</span>
              </button>
            </li>
          </ol>
          <div v-if="m.suggestions?.length" class="suggest">
            <button v-for="s in m.suggestions" :key="s" type="button" class="chip" @click="ask(s)">{{ s }}</button>
          </div>
          <ul v-if="m === lastApp && m.pills?.length" class="pills" aria-label="How your request was read" data-testid="chat-pills">
            <li v-for="p in m.pills" :key="p.key">
              <button type="button" class="pill" :aria-label="`Remove ${p.label}`" :data-pill="p.key" @click="chat.removePill(m, p.key)">
                {{ p.label }} <AppIcon name="close" />
              </button>
            </li>
          </ul>
        </div>
      </template>
      <p v-if="chat.busy" class="muted" role="status">Reading your request…</p>
    </div>

    <div class="presets" role="group" aria-label="Ready-made questions">
      <button v-for="p in PRESETS" :key="p.id" type="button" class="chip" :data-preset="p.id" @click="chat.preset(p)">{{ p.label }}</button>
    </div>

    <button type="button" class="link" :aria-expanded="help" aria-controls="chat-help" @click="help = !help">What can I ask?</button>
    <div v-if="help" id="chat-help" class="help" data-testid="chat-help">
      <section v-for="g in EXAMPLES" :key="g.task">
        <h3>{{ g.task }}</h3>
        <ul><li v-for="e in g.items" :key="e"><button type="button" class="link" @click="ask(e)">{{ e }}</button></li></ul>
      </section>
    </div>

    <form class="ask" @submit.prevent="submit">
      <input ref="input" v-model="text" type="text" maxlength="300" :placeholder="placeholder"
             aria-label="Ask about a place or your profile" data-testid="chat-input">
      <button type="submit" class="btn btn-primary send" aria-label="Send" :disabled="chat.busy || !text.trim()"><AppIcon name="send" /></button>
    </form>
    <p v-if="chat.error" class="error" role="alert" data-testid="chat-error">{{ chat.error }}</p>
  </section>
</template>

<style scoped>
p, h2, h3, ul, ol { margin: 0; }
.chat { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); min-height: 0; max-height: 100%; width: 100%; }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-3); padding-right: var(--space-1); }
.intro, .muted { color: var(--text-2); font-size: var(--fs-sm); }
.you { align-self: flex-end; max-width: 85%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-btn); background: var(--line); overflow-wrap: anywhere; }
.app { display: flex; flex-direction: column; gap: var(--space-2); overflow-wrap: anywhere; }
.quote { margin: 0; padding-left: var(--space-3); border-left: var(--focus-width) solid var(--line); font-size: var(--fs-sm); }
.items { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.item {
  width: 100%; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3);
  min-height: var(--touch-phone); padding: var(--space-2) var(--space-3); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn); background: transparent; color: var(--text); text-align: left; font: inherit; cursor: pointer;
}
.n { display: grid; place-items: center; width: var(--icon); height: var(--icon); border-radius: 50%; font-size: var(--fs-xs); font-weight: var(--fw-semibold); background: var(--line); color: var(--text); }
.n.easy { background: var(--easy); color: var(--ground); }
.n.mixed { background: var(--mixed); color: var(--ground); }
.n.hard { background: var(--hard); color: var(--ground); }
.suggest, .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip, .pill {
  min-height: var(--touch-phone); padding: var(--space-1) var(--space-3); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-pill); background: transparent; color: var(--text); font: inherit; font-size: var(--fs-sm); cursor: pointer;
}
.pills { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.pill { display: inline-flex; align-items: center; gap: var(--space-1); border-color: var(--text-muted); }
.pill :deep(svg) { width: var(--fs-sm); height: var(--fs-sm); }
.link { align-self: flex-start; border: 0; background: none; padding: var(--space-1) 0; color: var(--text-2); text-decoration: underline; font: inherit; font-size: var(--fs-sm); cursor: pointer; }
.help { display: grid; gap: var(--space-2); max-height: 40%; overflow-y: auto; }
.help h3 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.help ul { list-style: none; padding: 0; }
.ask { display: flex; gap: var(--space-2); }
.ask input {
  flex: 1; min-width: 0; min-height: var(--touch-phone); padding: var(--space-2) var(--space-3); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn); background: transparent; color: var(--text); font: inherit;
}
.ask input:focus-visible, .chip:focus-visible, .pill:focus-visible, .item:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.send:disabled { opacity: var(--inactive-opacity); }
.error { color: var(--hard-text); font-size: var(--fs-sm); }
.phone { border-radius: 0; height: 100%; }
</style>
