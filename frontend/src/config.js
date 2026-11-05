// Frontend settings that are not visual. Colours, fonts and sizes live in styles/style.css.

export default {
  radius: {
    min: 50, // a smaller circle snaps to this (m)
    max: 500, // hard maximum (m)
    default: 200, // when a radius is needed without the pointer (keyboard, search)
    rounding: 10, // chip value and stored radius are rounded to this (m)
    keyboardStep: 10, // arrow keys (m)
  },
  circlePoints: 64,

  // Start view: Stephansplatz, Vienna. Any location can be selected (brief §3).
  start: { lat: 48.2085, lon: 16.3721, zoom: 16 },

  mapStyles: {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  },

  // "About N street photos" before loading: a cheap estimate, no API calls.
  // Kept photos per km² from the Stephansplatz 200 m run (234 photos in 0.126 km²).
  photosPerKm2: 1860,

  // Thermal window shown before analysis (brief §6, Infrared.city windows).
  thermalDefault: { season: 'summer', time: '15:00' },
  // Feels-like °C to the two-sided 1–5 score (brief §4, standard UTCI stress categories):
  // above heat[2] → 1, heat[1] → 2, heat[0] → 3; from cold[0] up to heat[0] → 5 (no stress);
  // cold[1]–cold[0] → 4, cold[2]–cold[1] → 3, cold[3]–cold[2] → 2, below cold[3] → 1.
  // Personal limits (from the profile) will shift these; not yet.
  thermalLimits: { heat: [26, 32, 38], cold: [9, 0, -13, -27] },
  // Walking speed for "2 min away" on the place card (about 4.8 km/h).
  walkMetresPerMinute: 80,
  // Wait this long after the last season or time change before asking for it (each new one is billed).
  thermalDebounceMs: 700,
  seasons: ['spring', 'summer', 'autumn', 'winter'],

  // Routes (brief §3): the limits of the API (config/tool.yaml, routes), checked here before asking.
  routes: {
    minM: 50, // start and end closer than this are not a route
    maxM: 1500, // straight line, and the longest walk
  },

  // SenCity API. Empty = same origin (/api, proxied by Vite in development).
  apiBase: import.meta.env.VITE_API_BASE ?? '',

  // Search (brief §3): suggestions while typing, through the API (Photon).
  search: {
    minChars: 3,
    debounceMs: 300,
    placeZoom: 17, // zoom for a result without an extent (an address, a stop)
    maxZoom: 18, // never zoom in further than this for a street or area
  },
}
