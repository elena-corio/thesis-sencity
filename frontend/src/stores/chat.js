import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import config from '../config.js'
import router from '../router.js'
import { askChat, searchPlaces } from '../lib/api.js'
import { midpoint } from '../lib/geo.js'
import { LEVEL, easierNearby } from '../lib/nearby.js'
import { placeGroup } from '../lib/place.js'
import { explainPlace, filterPlaces, levelOn, prepareCope, summariseProfile } from '../lib/chat/execute.js'
import { clean, isThis, pillsOf, withoutPill } from '../lib/chat/intent.js'
import * as T from '../lib/chat/templates.js'
import { useAreaStore } from './area.js'
import { useProfileStore } from './profile.js'
import { useRoutesStore } from './routes.js'
import { useSensesStore } from './senses.js'

const MARKED = 5 // places marked on the map for one request
const A11_WORDS = { 1: 'not at all comfortable', 5: 'very comfortable', ...config.comfortWords }

/**
 * The chat assistant (Elena, 2026-11-21). A message goes to POST /api/chat, which sends only its text to the model and
 * returns an intent; a ready-made prompt or a removed pill builds the intent here, with no model call. The intent is
 * carried out on what the browser holds (the area, its ratings, your profile) through the app's own stores, and the
 * reply is written from templates (lib/chat/templates.js). Nothing is kept after the page closes; nothing is logged.
 * `messages`: [{ role: 'you' | 'app', text, quote?, suggestions?, items?, pills?, intent? }].
 */
export const useChatStore = defineStore('chat', () => {
  const area = useAreaStore()
  const routes = useRoutesStore()
  const senses = useSensesStore()
  const profile = useProfileStore()

  const open = ref(false)
  const messages = ref([])
  const busy = ref(false)
  const error = ref('')
  /** A request waiting for its area to load and be rated (filter_places near a new place). */
  const pending = ref(null)
  let controller = null

  function show() { open.value = true; profile.ensureSurvey() }
  function close() { open.value = false }

  const name = (code) => {
    const row = profile.survey?.questions.flatMap((q) => q.rows ?? []).find((r) => r.code === code)
    return row?.[config.language] ?? code.replaceAll('_', ' ')
  }
  const mode = () => (router.currentRoute.value.params.mode === 'routes' ? 'routes' : 'area')
  const say = (reply, intent = null, pills = []) => {
    const lead = intent?.language === 'it' ? `${T.ITALIAN_NOTE} ` : ''
    messages.value = [...messages.value, { role: 'app', ...reply, text: lead + reply.text, intent, pills }]
  }

  /** A message typed by the person. Kept in the input until it is read ("Could not send. Try again."). */
  async function send(text) {
    const message = text.trim()
    if (!message || busy.value) return false
    controller?.abort()
    controller = new AbortController()
    busy.value = true
    error.value = ''
    try {
      const intent = clean(await askChat(message, controller.signal))
      messages.value = [...messages.value, { role: 'you', text: message }]
      if (!intent) say(T.outOfScope())
      else await run(intent)
      return true
    } catch (err) {
      if (controller.signal.aborted) return false
      error.value = err.status === 429 && err.message ? err.message : T.failed().text
      return false
    } finally {
      busy.value = false
    }
  }

  /** A ready-made prompt: its words as the message, its intent at once. */
  async function preset(p) {
    messages.value = [...messages.value, { role: 'you', text: p.label }]
    show()
    await run(p.intent)
  }

  /** Remove one pill of the last reply: the same request without it, no model call. */
  async function removePill(message, key) {
    await run(withoutPill(message.intent, key))
  }

  async function find(q) {
    const near = area.analysed ?? area.centre ?? config.start
    try {
      return (await searchPlaces(q, near))?.[0] ?? null
    } catch {
      return null
    }
  }

  /** A place of the loaded area by its name ("Graben"), or the open one ("this"). */
  function placeNamed(near) {
    const features = area.segments?.features ?? []
    if (!near || isThis(near)) return area.selected ?? null
    const q = near.toLowerCase()
    return features.find((f) => (f.properties.name ?? '').toLowerCase() === q)
      ?? features.find((f) => (f.properties.name ?? '').toLowerCase().includes(q)) ?? null
  }
  const listedOf = (f) => {
    const p = senses.placeFor(f.properties.photos)
    return p.status === 'rated' ? p.listed : null
  }

  /** Carry out one intent and reply. */
  async function run(intent) {
    error.value = ''
    const act = ACTIONS[intent.action] ?? ACTIONS.out_of_scope
    await act(intent)
  }

  function applyView(intent) {
    const m = mode()
    const store = m === 'routes' ? routes : area
    if (intent.layer && intent.layer !== store.layer) store.setLayer(intent.layer)
    if (intent.season || intent.time) {
      const change = {}
      if (intent.season) change.season = intent.season
      if (intent.time) change.time = intent.time
      store.setThermalWindow(change)
    }
    return store.layer
  }

  const ACTIONS = {
    async filter_places(intent) {
      if (mode() !== 'area') await router.push('/area')
      const layer = applyView(intent)
      const pills = pillsOf(intent, { layer, name })
      if (intent.near && !isThis(intent.near)) {
        const place = await find(intent.near)
        if (!place) return say(T.notFound(intent.near), intent, pills)
        area.setCentre(place, place.name)
        if (intent.radius_m) area.setRadius(intent.radius_m)
        area.analyse()
        pending.value = { intent: { ...intent, near: null, radius_m: null }, pills }
        return say({ text: `Loading the area around ${place.name} (${area.radius} m). The matching places will be marked when its photos are rated.` }, intent, pills)
      }
      if (area.step !== 'analysed' || !area.segments) return say(T.needArea(), intent, pills)
      const around = intent.radius_m ? area.analysed : null
      const r = filterPlaces(intent, { features: area.visibleSegments?.features ?? [], layer, listedOf, around, radius: intent.radius_m })
      const marked = r.matches.slice(0, MARKED).map((m) => ({ f: m.f, mid: midpoint(m.f.geometry), type: placeGroup(m.f.properties, m.f.geometry.type), level: m.level }))
      if (marked.length) area.showChatResults(marked)
      else area.clearChatResults()
      const reply = T.filterReply(r, { pills, layer, level: intent.level, rating: senses.runs.area.status === 'rating', shown: marked.length })
      say({ ...reply, items: marked.map((m, i) => ({ n: i + 1, id: m.f.properties.id, name: m.f.properties.name || 'Unnamed place', level: m.level })) }, intent, pills)
    },

    async explain_place(intent) {
      let f = placeNamed(intent.near)
      if (!f && intent.near && !isThis(intent.near)) {
        return say({ text: `${intent.near} is not in the loaded area. Load an area around it first, such as “places near ${intent.near}”.` }, intent)
      }
      if (!f) return say(T.needPlace(), intent)
      if (area.selectedId !== f.properties.id) area.select(f.properties.id, midpoint(f.geometry))
      const layer = intent.layer ?? area.layer
      const e = explainPlace({ f, place: senses.placeFor(f.properties.photos), layer, answers: profile.profile?.answers ?? null })
      say(T.explainReply(e, { name, personal: profile.personal }), intent, pillsOf(intent, { layer, name }))
    },

    async plan_route(intent) {
      const pills = pillsOf(intent, { name })
      if (!intent.end) return say({ text: 'Name where you want to go, such as “a calmer way to the Naschmarkt”.' }, intent, pills)
      const to = await find(intent.end)
      if (!to) return say(T.notFound(intent.end), intent, pills)
      let from = null
      if (intent.start) {
        from = await find(intent.start)
        if (!from) return say(T.notFound(intent.start), intent, pills)
      } else if (area.analysed) from = { lat: area.analysed.lat, lon: area.analysed.lon, name: area.centreName || 'the area’s centre' }
      if (!from) return say({ text: `Name a start too, such as “from Stephansplatz to ${intent.end}”.` }, intent, pills)
      await router.push('/routes')
      routes.setPoint('start', from, from.name, true)
      routes.setPoint('end', to, to.name, true)
      const layer = intent.calmer ? 'senses' : intent.layer ?? routes.layer
      if (layer !== routes.layer) routes.setLayer(layer)
      routes.analyse()
      say(T.routeReply({ from: from.name, to: to.name, layer }), intent, pills)
    },

    async set_view(intent) {
      if (!intent.layer && !intent.season && !intent.time) return say({ text: 'Name a layer (Senses, Thermal or Overall), a season or a time.' }, intent)
      const layer = applyView(intent)
      say(T.viewReply({ layer, season: intent.season, time: intent.time }), intent, pillsOf(intent, { layer, name }))
    },

    async summarise_profile(intent) {
      const survey = await profile.ensureSurvey()
      if (!profile.profile || !survey) return say(T.needProfile(), intent)
      const s = summariseProfile(survey, profile.profile.answers)
      say(T.profileReply(s, intent.topic ?? 'overall', { name, a11Words: (n) => A11_WORDS[n] }), intent, pillsOf(intent, { name }))
    },

    async prepare_cope(intent) {
      if (!profile.profile) return say(T.needProfile(), intent)
      const f = placeNamed(intent.near)
      const layer = area.layer
      let easier = null
      if (f) {
        if (area.selectedId !== f.properties.id) area.select(f.properties.id, midpoint(f.geometry))
        const best = easierNearby(f, area.segments?.features ?? [], { levelOf: (g) => LEVEL[levelOn(g, layer)] ?? null })
        easier = best ? { name: best.f.properties.name, d: best.d } : null
      }
      const p = prepareCope({ prepare: profile.profile.prepare, listed: f ? listedOf(f) : null, easier,
        name: f?.properties.name || (intent.near && !isThis(intent.near) ? intent.near : null) })
      say(T.copeReply(p, { name }), intent, pillsOf(intent, { name }))
    },

    async out_of_scope(intent) {
      say(T.outOfScope(), intent)
    },
  }

  // A request near a new place: carried out once that area is ready on its layer (Thermal: its values; Senses and
  // Overall: its photos rated).
  watch(() => area.load === 'ready' && (area.layer === 'thermal' ? area.thermal === 'ready' : area.sensesFinished), (ready) => {
    if (!ready || !pending.value) return
    const { intent } = pending.value
    pending.value = null
    ACTIONS.filter_places(intent)
  })

  /** The place opened from a result card: its card offers "Back to the chat" while it is the one selected. */
  const returnTo = ref(null)
  /** Open a place from a result card (Elena, 2026-11-21): the chat gives way to the place's card, and the street is
   *  selected on the map, as from its pin. The conversation stays; "Back to the chat" (or Ask) brings it back. */
  function openPlace(id, keyboard = false) {
    const m = area.markers.find((x) => x.f.properties.id === id)
    if (m) area.selectMarker(m, keyboard)
    else {
      // An earlier reply's place, no longer marked: select it from the area itself.
      const f = area.segments?.features.find((x) => x.properties.id === id)
      if (!f) return
      area.byKeyboard = keyboard
      area.select(id, midpoint(f.geometry))
    }
    returnTo.value = id
    close()
  }
  /** "Back to the chat" on the place's card. */
  function backToChat() {
    returnTo.value = null
    show()
  }

  function clear() {
    messages.value = []
    pending.value = null
    area.clearChatResults()
  }

  return { open, messages, busy, error, pending, returnTo, show, close, send, preset, removePill, run, openPlace, backToChat, clear, name }
})
