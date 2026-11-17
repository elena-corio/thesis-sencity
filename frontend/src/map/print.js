// The report's maps (brief §7: "rendered from MapLibre … in light style with print colours"): a hidden map of its own,
// the size of the printed map, in the light base map (never darkened, whatever the app's theme), with the area's
// streets or the two routes in the print colours (--report-easy, --report-mixed, --report-hard: light to dark, so
// they read in grey too). The picture stays in memory (a data URL) for as long as the report is open; nothing is saved
// or sent. The base map's tiles are the same public ones the app's map already shows.
import { Map as MapLibreMap } from 'maplibre-gl'
import config from '../config.js'
import { cssVar } from '../composables.js'
import { circleRing } from '../lib/geo.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const num = (name) => Number(cssVar(name))

/** A report size token in mm ("64mm") as CSS px. */
const px = (name) => Math.round(parseFloat(cssVar(name)) * (96 / 25.4))
/** The printed map's size in CSS px: the page's width inside its margins, and the map's own height token. */
export const mapSize = (heightToken) => ({ width: px('--report-page-w') - 2 * px('--report-margin'), height: px(heightToken) })

/** The colour of a state, in print colours; anything else (no photo, no value, no data) is the print grey. */
function stateColor(prop) {
  return ['match', ['get', prop], 'easy', cssVar('--report-easy'), 'mixed', cssVar('--report-mixed'),
    'hard', cssVar('--report-hard'), cssVar('--report-none')]
}

/** [[w, s], [e, n]] around every coordinate of these geometries. */
function boundsOf(features) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const add = ([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
  const walk = (c) => (typeof c[0] === 'number' ? add(c) : c.forEach(walk))
  for (const f of features) walk(f.geometry.coordinates)
  return [[w, s], [e, n]]
}

/**
 * Draw a hidden map and return its picture as a PNG data URL, or null if it could not be drawn in time (the report
 * then leaves the map out rather than showing an empty frame).
 * @param {{width:number, height:number, features:object[], setup:(map:MapLibreMap) => void, padding?:number}} o
 *   width and height in CSS px (drawn at twice that, so print stays sharp)
 */
export function snapshot({ width, height, features, setup, padding = 24, timeoutMs = 20000 }) {
  // Room at the bottom for the legend that sits on the map, so it never covers a street or a route.
  const pad = { top: padding, left: padding, right: padding, bottom: padding + px('--report-map-legend-h') }
  if (!features.length) return Promise.resolve(null)
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  Object.assign(box.style, { position: 'fixed', left: '-10000px', top: '0', width: `${width}px`, height: `${height}px` })
  document.body.appendChild(box)
  let map
  return new Promise((resolve) => {
    const done = (url) => {
      clearTimeout(timer)
      try { map?.remove() } catch { /* already gone */ }
      box.remove()
      resolve(url)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    try {
      map = new MapLibreMap({
        container: box,
        style: config.mapStyles.light,
        bounds: boundsOf(features),
        fitBoundsOptions: { padding: pad },
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        pixelRatio: 2,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      })
    } catch {
      done(null)
      return
    }
    map.on('error', () => {}) // a missing tile is not a failure: the picture is taken when the map is idle
    map.once('style.load', () => {
      try {
        // No place names (city, district) over the streets: street names stay, as on board 8.
        for (const { id } of map.getStyle().layers) if (/^label_|^airport$/.test(id)) map.setLayoutProperty(id, 'visibility', 'none')
        setup(map)
      } catch {
        done(null)
        return
      }
      map.once('idle', () => {
        try { done(map.getCanvas().toDataURL('image/png')) } catch { done(null) }
      })
    })
  })
}

/** The area (board 8): its circle (dashed, Elena 2026-11-17), and every street and place in the colour of its state on the report's layer. */
export function areaSnapshot({ width, height, features, layer, centre, radius }) {
  const circle = { type: 'Feature', geometry: { type: 'LineString', coordinates: circleRing(centre, radius) }, properties: {} }
  const prop = `${layer}_state`
  return snapshot({
    width, height, features: [circle],
    setup: (map) => {
      map.addSource('r-streets', { type: 'geojson', data: { type: 'FeatureCollection', features } })
      map.addSource('r-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [circle] } })
      map.addLayer({ id: 'r-circle', type: 'line', source: 'r-circle',
        paint: { 'line-color': cssVar('--report-ink-2'), 'line-width': num('--report-map-circle'),
          'line-dasharray': cssVar('--report-map-circle-dash').split(/\s+/).map(Number) } })
      map.addLayer({ id: 'r-places', type: 'fill', source: 'r-streets', filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': stateColor(prop), 'fill-opacity': num('--report-map-fill-opacity') } })
      map.addLayer({ id: 'r-lines', type: 'line', source: 'r-streets', filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': stateColor(prop), 'line-width': num('--report-map-line') } })
    },
  })
}

/** The two routes (board 8b): A solid, B dashed, each stretch in its state's colour; Start a ring, End a dot. */
export function routesSnapshot({ width, height, routes, start, end }) {
  const features = routes.flatMap((r) => r.stretches.map((s) => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: s.coordinates }, properties: { route: r.id, state: s.state },
  })))
  const pin = (p, kind) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { kind } })
  const pins = [start && pin(start, 'start'), end && pin(end, 'end')].filter(Boolean)
  return snapshot({
    width, height, features: [...features, ...pins], padding: 32,
    setup: (map) => {
      map.addSource('r-route', { type: 'geojson', data: { type: 'FeatureCollection', features } })
      map.addSource('r-pins', { type: 'geojson', data: pins.length ? { type: 'FeatureCollection', features: pins } : EMPTY })
      const line = { 'line-color': stateColor('state'), 'line-width': num('--report-map-line') }
      map.addLayer({ id: 'r-route-a', type: 'line', source: 'r-route', filter: ['==', ['get', 'route'], 'A'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: line })
      map.addLayer({ id: 'r-route-b', type: 'line', source: 'r-route', filter: ['==', ['get', 'route'], 'B'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { ...line, 'line-dasharray': cssVar('--report-map-dash').split(/\s+/).map(Number) } })
      map.addLayer({ id: 'r-pins', type: 'circle', source: 'r-pins',
        paint: {
          'circle-radius': num('--report-map-pin'),
          'circle-color': ['match', ['get', 'kind'], 'start', cssVar('--report-bg'), cssVar('--report-ink')],
          'circle-stroke-color': cssVar('--report-ink'),
          'circle-stroke-width': num('--report-map-pin-edge'),
        } })
    },
  })
}
