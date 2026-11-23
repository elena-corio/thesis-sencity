import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import config from '../config.js'
import router from '../router.js'
import { askChat, searchPlaces } from '../lib/api.js'
import { midpoint } from '../lib/geo.js'
import { LEVEL, easierNearby } from '../lib/nearby.js'
import { placeGroup } from '../lib/place.js'
import { routeVerdict } from '../lib/report.js'
import { hardShare } from '../lib/senses.js'
import { explainPlace, filterPlaces, levelOn, placeFacts, prepareCope, summariseProfile } from '../lib/chat/execute.js'
import { isCold, thermalLimits } from '../lib/thermal.js'
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

  /** The places of the last reply that marks any (Elena, 2026-11-21): on the map only while the chat is open, so the area's
   *  own recommendations are back when it closes, and these come back when it opens again. */
  const marked = ref([])
  function mark() {
    if (open.value && marked.value.length) area.showChatResults(marked.value)
    else if (area.markerKind === 'chat') {
      area.clearChatResults()
      // A place opened from the chat stays the selected one; the area's pins stay hidden until "Back to area", as
      // after any selection.
      if (area.selectedId) area.markersCollapsed = true
    }
  }
  function show() { open.value = true; profile.ensureSurvey(); mark() }
  function close() { open.value = false; mark() }

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

  /** How to prepare for the route on the map: its streets as the facts, the person's own answers as the tips. */
  function prepareRoute(intent) {
    const list = routes.shown
    if (!list.length) return say({ text: 'Plan a route first, such as “the easiest route from Karlsplatz to Stadtpark”.' }, intent)
    const route = routes.selectedRoute ?? list.find((r) => r.id === 'B') ?? list[0]
    const ids = [...new Set(route.parts.map((p) => p.segment_id).filter(Boolean))]
    const features = ids.map((id) => routes.segments.get(id)).filter(Boolean)
    const limits = thermalLimits()
    const facts = placeFacts(features, { listedOf, layer: routes.layer, scope: 'route', coldOf: (t) => isCold(t, limits) })
    const info = routes.info
    const when = info ? `${info.season} at ${info.time}` : ''
    return say(T.copeReply(facts, prepareCope({ prepare: profile.profile?.prepare }), { name, personal: profile.personal, when,
      place: list.length > 1 ? `route ${route.id}` : null }), intent, pillsOf(intent, { name }))
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
      const list = r.matches.slice(0, MARKED).map((m) => ({ f: m.f, mid: midpoint(m.f.geometry), type: placeGroup(m.f.properties, m.f.geometry.type), level: m.level }))
      chatMarked(list)
      const reply = T.filterReply(r, { pills, layer, level: intent.level, rating: senses.runs.area.status === 'rating', shown: list.length })
      say({ ...reply, items: list.map((m, i) => ({ n: i + 1, id: m.f.properties.id, name: m.f.properties.name || 'Unnamed place', level: m.level })) }, intent, pills)
    },

    async explain_place(intent) {
      let f = placeNamed(intent.near)
      if (!f && intent.near && !isThis(intent.near)) {
        return say({ text: `${intent.near} is not in the loaded area. Load an area around it first, such as “places near ${intent.near}”.` }, intent)
      }
      if (!f) return say(T.needPlace(), intent)
      if (area.selectedId !== f.properties.id) selectHere(f)
      const layer = intent.layer ?? area.layer
      const e = explainPlace({ f, place: senses.placeFor(f.properties.photos), layer, answers: profile.profile?.answers ?? null })
      say(T.explainReply(e, { name, personal: profile.personal }), intent, pillsOf(intent, { layer, name }))
    },

    async plan_route(intent) {
      const pills = pillsOf(intent, { name })
      // "Compare these two routes" (Elena, 2026-11-22): no start and no end: the routes already on the map.
      if (!intent.start && !intent.end) {
        if (!routes.hasResult) return say({ text: 'Plan a route first, such as “the easiest route from Karlsplatz to Stadtpark”.' }, intent, pills)
        if (mode() !== 'routes') await router.push('/routes')
        return say(T.compareReply(routes.shown, { layer: routes.layer, verdict: routeVerdict(routes.layer, routes.shown, routes.verdict),
          hardOf: (r) => (routes.layer === 'thermal' ? r.hard_share : hardShare(r.stretches)) }), intent, pills)
      }
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
      // Calmer or easiest: the current layer if it is Senses or Overall (Overall counts heat too), else Senses.
      const layer = intent.layer ?? (intent.calmer && routes.layer === 'thermal' ? 'senses' : routes.layer)
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
      // "This route" (Elena, 2026-11-22): the facts along the route on the map (the selected one, else the easier B).
      if (/\b(route|routes|way|walk|percorso|strada per)\b/i.test(intent.near ?? '')) return prepareRoute(intent)
      // The open place ("this street"), a place of the area by name, or else the whole area ("this area", nothing named).
      const wantsArea = !intent.near || /(area|zona|zone|neighbou?rhood|quartiere)/i.test(intent.near)
      const f = wantsArea ? null : placeNamed(intent.near)
      if (!f && intent.near && !isThis(intent.near) && !wantsArea) {
        return say({ text: `${intent.near} is not in the loaded area. Load an area around it first, such as “places near ${intent.near}”.` }, intent)
      }
      if (area.step !== 'analysed' || !area.segments) return say(T.needArea(), intent)
      const layer = area.layer
      const limits = thermalLimits()
      let easier = null
      if (f) {
        if (area.selectedId !== f.properties.id) selectHere(f)
        const best = easierNearby(f, area.segments.features, { levelOf: (g) => LEVEL[levelOn(g, layer)] ?? null })
        easier = best ? { id: best.f.properties.id, name: best.f.properties.name, d: best.d } : null
      }
      const features = f ? [f] : (area.visibleSegments?.features ?? [])
      const facts = placeFacts(features, { listedOf, layer, scope: f ? 'place' : 'area', easier, coldOf: (t) => isCold(t, limits) })
      const info = area.thermalInfo
      const when = info ? `${info.season} at ${info.time}` : ''
      say(T.copeReply(facts, prepareCope({ prepare: profile.profile?.prepare }), { name, personal: profile.personal, when,
        place: f?.properties.name || null, placeId: f?.properties.id ?? null }), intent, pillsOf(intent, { name }))
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
  // The chat's own selections (the place it explains) keep the chat open; a place clicked on the map opens its card
  // (Elena, 2026-11-22), as one clicked in a reply does.
  let selectingHere = false
  function selectHere(f) {
    selectingHere = true
    area.select(f.properties.id, midpoint(f.geometry))
    selectingHere = false
  }
  // flush 'sync': runs inside area.select, while selectingHere still says who selected.
  watch(() => area.selectedId, (id) => {
    if (!id || selectingHere || !open.value) return
    returnTo.value = id
    close()
  }, { flush: 'sync' })
  // A stretch of a route clicked on the map: its card, too.
  watch(() => routes.selectedStretch, (stretch) => {
    if (stretch && open.value) close()
  })
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

  function chatMarked(list) {
    marked.value = list
    mark()
  }

  function clear() {
    messages.value = []
    pending.value = null
    marked.value = []
    mark()
  }

  return { open, messages, busy, error, pending, returnTo, show, close, send, preset, removePill, run, openPlace, backToChat, clear, name }
})
