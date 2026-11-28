import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import config from '../config.js'
import router from '../router.js'
import { askChat, loadArea, searchPlaces } from '../lib/api.js'
import { midpoint } from '../lib/geo.js'
import { LEVEL, easierNearby } from '../lib/nearby.js'
import { placeGroup } from '../lib/place.js'
import { routeVerdict } from '../lib/report.js'
import { hardShare } from '../lib/senses.js'
import { SEASONS, compareSeasons, explainPlace, filterPlaces, levelOn, placeFacts, prepareCope, summariseProfile } from '../lib/chat/execute.js'
import { isCold, thermalLimits, thermalState } from '../lib/thermal.js'
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
  /** "X could not be loaded: <the server's own sentence>", or "X could not be loaded. Try again in a moment." */
  const failedText = (what, why) => (why ? `${what}: ${why.trim().replace(/([^.!?])$/, '$1.')}` : `${what}. Try again in a moment.`)
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
      // Calmer or easiest: the current layer if it is Senses or Overall, else the default, Overall (Elena, 2026-11-23).
      const layer = intent.layer ?? (intent.calmer && routes.layer === 'thermal' ? config.layerDefault : routes.layer)
      if (layer !== routes.layer) routes.setLayer(layer)
      routes.analyse()
      routePending.value = { intent, pills }
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

    async compare_seasons(intent) {
      if (mode() !== 'area') await router.push('/area')
      const wantsArea = !intent.near || /(area|zona|zone|neighbou?rhood|quartiere)/i.test(intent.near)
      const f = wantsArea ? null : placeNamed(intent.near)
      if (!f && !wantsArea && !isThis(intent.near)) {
        return say({ text: `${intent.near} is not in the loaded area. Load an area around it first, such as “places near ${intent.near}”.` }, intent)
      }
      if (area.step !== 'analysed' || !area.segments) return say(T.needArea(), intent)
      // "This" with no place open ("best season here?" read as "this"): the whole area.
      if (f && area.selectedId !== f.properties.id) selectHere(f)
      const time = seasonTime()
      const missing = SEASONS.length - knownSeasons(time).length
      if (!missing) return answerSeasons(intent, f, time)
      // Each new simulation is billed: ask first (Elena, 2026-11-23); "Run them" carries on (act).
      seasonAsk = { intent, id: f?.properties.id ?? null, time, key: areaKey() }
      say(T.seasonsAsk(missing, { time, place: f?.properties.name || null }), intent, pillsOf(intent, { name }))
    },

    async out_of_scope(intent) {
      say(T.outOfScope(), intent)
    },
  }

  // compare_seasons (Elena, 2026-11-23: "which season is the best to go?"): thermal comfort for each season at the time
  // on the map, for the loaded area, compared with the person's limits. Values are kept for this session only; the
  // server caches the runs, so asking again costs nothing.
  const seasonValues = new Map() // `${lat},${lon},${radius}|${season}|${time}` → { street id: °C }
  const seasonRun = ref(null) // { done, total, season } while the simulations run
  let seasonAsk = null // the request waiting for "Run them"
  let seasonController = null
  const areaKey = () => (area.analysed ? `${area.analysed.lat},${area.analysed.lon},${area.analysed.radius}` : '')
  const windowKey = (season, time, key = areaKey()) => `${key}|${season}|${time}`
  const seasonTime = () => area.thermalInfo?.time ?? area.thermalWindow.time
  /** The seasons already known at `time`: the one on the map (its values are on the streets), and earlier runs. */
  function knownSeasons(time) {
    const info = area.thermalInfo
    if (info && info.time === time && area.thermal === 'ready') {
      const values = Object.fromEntries((area.segments?.features ?? []).filter((f) => f.properties.utci != null)
        .map((f) => [f.properties.id, f.properties.utci]))
      if (Object.keys(values).length) seasonValues.set(windowKey(info.season, time), values)
    }
    return SEASONS.filter((s) => seasonValues.has(windowKey(s, time)))
  }
  function answerSeasons(intent, f, time) {
    const limits = thermalLimits()
    const values = Object.fromEntries(SEASONS.map((s) => [s, seasonValues.get(windowKey(s, time))]).filter(([, v]) => v))
    const r = compareSeasons(f ? [f] : (area.segments?.features ?? []), values,
      { stateOf: (t) => thermalState(t, limits), coldOf: (t) => isCold(t, limits) })
    const showing = area.layer !== 'senses' && area.thermal === 'ready' && area.thermalInfo?.time === time
    say(T.seasonsReply(r, { time, place: f ? f.properties.name || 'this place' : null, personal: profile.personal,
      current: area.thermalInfo?.season ?? null, showing }), intent, pillsOf(intent, { name }))
  }
  async function runSeasons() {
    const ask = seasonAsk
    if (!ask || seasonRun.value) return
    seasonAsk = null
    if (ask.key !== areaKey()) return say({ text: 'The area has changed since. Ask again for this one.' })
    const todo = SEASONS.filter((s) => !seasonValues.has(windowKey(s, ask.time, ask.key)))
    seasonController?.abort()
    seasonController = new AbortController()
    const signal = seasonController.signal
    try {
      for (const [i, season] of todo.entries()) {
        seasonRun.value = { done: i, total: todo.length, season }
        let values = null
        let problem = ''
        await loadArea({ ...area.analysed, season, time: ask.time, layer: 'thermal' }, (e) => {
          if (e.type === 'thermal') values = e.values
          else if (e.type === 'thermal_error' || e.type === 'error') problem = e.message
        }, signal)
        if (signal.aborted) return
        if (!values) {
          return say({ text: failedText(`Thermal comfort for ${season} could not be loaded`, problem) }, ask.intent)
        }
        seasonValues.set(windowKey(season, ask.time, ask.key), values)
      }
    } catch (err) {
      if (signal.aborted) return
      return say({ text: err.status === 429 && err.message ? err.message : 'Thermal comfort could not be loaded. Try again in a moment.' }, ask.intent)
    } finally {
      if (!signal.aborted) seasonRun.value = null
    }
    const f = ask.id ? area.segments?.features.find((x) => x.properties.id === ask.id) ?? null : null
    answerSeasons(ask.intent, f, ask.time)
  }
  // A new area stops the comparison of the old one.
  watch(areaKey, () => {
    seasonAsk = null
    if (seasonRun.value) {
      seasonController?.abort()
      seasonRun.value = null
    }
  })
  /** "Show spring": the map's season (cached by then, so at once); on Senses, the default layer, where it shows. */
  function showSeason(season) {
    if (area.thermal === 'ready') {
      area.setThermalWindow({ season })
      if (area.layer === 'senses') area.setLayer(config.layerDefault)
      return
    }
    area.thermalWindow = { ...area.thermalWindow, season }
    area.setLayer(area.layer === 'senses' ? config.layerDefault : area.layer)
  }
  /** A button in a reply ("Run them", "Show spring"). */
  function act(id) {
    if (id === 'run-seasons') return runSeasons()
    if (id.startsWith('season:')) return showSeason(id.slice('season:'.length))
  }

  // Loading inside the chat (Elena, 2026-11-23): while the chat is open it takes the card's place, so the area's or the
  // routes' progress is shown here, in one line, and the reply comes when they are ready (or say they failed).
  const progress = computed(() => {
    if (seasonRun.value) {
      const r = seasonRun.value
      return { text: `Comparing the seasons: simulating ${r.season} (${r.done + 1} of ${r.total}), a few minutes each…`, share: r.total ? r.done / r.total : null }
    }
    if (routes.load === 'loading') {
      const p = routes.progress
      const what = { streets: 'finding the streets', photos: `street photos ${p.done} of ${p.total}`, thermal: 'simulating thermal comfort (this can take a few minutes)', routes: 'comparing the routes' }[p.stage] ?? 'loading'
      return { text: `Analysing the routes: ${what}…`, share: p.stage === 'photos' && p.total ? p.done / p.total : null }
    }
    if (senses.routesRating) {
      const r = senses.routesProgress ?? { done: 0, total: 0 }
      return { text: `Rating the photos along the routes: ${r.done} of ${r.total}…`, share: r.total ? r.done / r.total : null }
    }
    if (area.load === 'loading') {
      const p = area.progress
      return p.stage === 'streets'
        ? { text: 'Loading the area: finding the streets…', share: null }
        : { text: `Loading the area: street photos ${p.done} of ${p.total}…`, share: p.total ? p.done / p.total : null }
    }
    if (area.thermal === 'loading') return { text: 'Simulating thermal comfort for the area (this can take a few minutes)…', share: null }
    if (senses.areaRating) {
      const r = senses.areaProgress
      return { text: `Rating the photos: ${r.done} of ${r.total} places…`, share: r.total ? r.done / r.total : null }
    }
    return null
  })
  /** A route the chat asked for: its comparison as the reply once it is ready. */
  const routePending = ref(null)
  watch(() => routes.load === 'ready' && !senses.routesRating && routes.hasResult, (ready) => {
    if (!ready || !routePending.value) return
    const { intent, pills } = routePending.value
    routePending.value = null
    say(T.compareReply(routes.shown, { layer: routes.layer, verdict: routeVerdict(routes.layer, routes.shown, routes.verdict),
      hardOf: (r) => (routes.layer === 'thermal' ? r.hard_share : hardShare(r.stretches)) }), intent, pills)
  })
  watch(() => routes.load, (load) => {
    if (load !== 'error' || !routePending.value) return
    routePending.value = null
    say({ text: failedText('The routes could not be analysed', routes.error) })
  })
  watch(() => area.load, (load) => {
    if (load !== 'error' || !pending.value) return
    pending.value = null
    say({ text: failedText('The area could not be loaded', area.loadError) })
  })

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
    routePending.value = null
    seasonAsk = null
    marked.value = []
    mark()
  }

  return { open, messages, busy, error, pending, progress, returnTo, show, close, send, preset, removePill, run, act, openPlace, backToChat, clear, name }
})
