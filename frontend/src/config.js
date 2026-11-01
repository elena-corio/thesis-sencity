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

  // Heat window shown before analysis (brief §6, Infrared.city windows).
  heatDefault: { season: 'summer', time: '15:00' },
  seasons: ['spring', 'summer', 'autumn', 'winter'],

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
